/**
 * Toda a lógica de negócio do Bet Tracker, replicada a partir das fórmulas do
 * bet_tracker_calude.xlsx (ver ../docs/SCHEMA.md secção 2). Nenhuma função aqui
 * toca no SpreadsheetApp — recebem os dados já carregados (ver Code.gs) e
 * devolvem objetos simples prontos a converter para JSON.
 *
 * Boletins "Pendente" (ainda sem todos os resultados) continuam fora de TODOS os
 * cálculos (KPIs, banca, rollups) — tal como na Fase 2. A diferença é que agora
 * aparecem no `historico`, para se ver o que está por fechar sem abrir a Sheet.
 *
 * Desempenho: `computarDashboardCompleto_` faz UMA passagem sobre os dados e
 * devolve as fatias de TODAS as épocas de uma vez (`porEpoca`). O frontend troca
 * de época em memória, sem novo pedido ao servidor.
 *
 * Config versionada por data (stake/montante por combinação, odd mínima, tabelas
 * de multas): cada boletim/falta usa os valores em vigor NA SUA DATA, não os
 * valores atuais — ver `configParaData_`. Uma alteração feita na página de
 * Configurações só afeta boletins registados a partir da data escolhida.
 */

function calcularEpoca_(data, mesInicioEpoca) {
  if (!data) return '';
  var y = data.getFullYear();
  var m = data.getMonth() + 1; // JS: 0-based
  var anoInicio = y - 2000 - (m < mesInicioEpoca ? 1 : 0);
  return pad2_(anoInicio) + '/' + pad2_(anoInicio + 1);
}

function pad2_(n) {
  return (n < 10 ? '0' : '') + n;
}

/**
 * Escolhe, de uma lista de versões `[{vigenteDesde: Date|null, valor}, ...]`
 * ordenada da mais antiga para a mais recente, a que está em vigor numa data —
 * a última cujo `vigenteDesde` seja <= data (uma versão sem `vigenteDesde` é a
 * versão base, sempre elegível). Sem data (ex: boletim ainda sem data válida),
 * devolve sempre a mais recente.
 */
function versaoEmVigor_(versoes, data) {
  if (!versoes || versoes.length === 0) return undefined;
  if (!data) return versoes[versoes.length - 1].valor;
  var alvo = data.getTime();
  var melhor = versoes[0];
  for (var i = 0; i < versoes.length; i++) {
    var v = versoes[i];
    var desde = v.vigenteDesde ? v.vigenteDesde.getTime() : -Infinity;
    if (desde <= alvo) melhor = v; else break;
  }
  return melhor.valor;
}

/**
 * Resolve, para uma data, os campos VERSIONADOS da config (stake/montante por
 * combinação, odd mínima, tabelas de multas) — os únicos que uma alteração em
 * `Config_Geral`/`Config_MultaErros`/`Config_MultaAtrasos`/`Config_MultaFaltas`
 * deve aplicar só a boletins a partir da data escolhida, nunca aos já
 * registados. Os restantes campos (jogadores, desportos, banca inicial, nº de
 * jogadores, mês de início de época) não são versionados — vêm sempre da
 * config "atual" tal como já funcionava antes desta funcionalidade.
 */
function configParaData_(config, data) {
  var h = config.historicoConfig;
  return {
    geral: {
      bancaInicial: config.geral.bancaInicial,
      montanteCombinacao: versaoEmVigor_(h.montanteCombinacao, data),
      lucroMinimo: config.geral.lucroMinimo,
      numeroJogadores: config.geral.numeroJogadores,
      oddMinima: versaoEmVigor_(h.oddMinima, data),
      mesInicioEpoca: config.geral.mesInicioEpoca,
    },
    jogadores: config.jogadores,
    tiposJornada: config.tiposJornada,
    desportos: config.desportos,
    multaErros: versaoEmVigor_(h.multaErros, data),
    multaAtrasos: versaoEmVigor_(h.multaAtrasos, data),
    multaFaltas: versaoEmVigor_(h.multaFaltas, data),
  };
}

/**
 * Épocas existentes, derivadas das datas reais dos dados (Apostas, MultaFaltas,
 * Levantamentos). Substitui a aba Config_Epocas, que era um resíduo do Excel: um
 * boletim novo numa época ainda não vista faz a época aparecer sozinha, sem
 * pré-preenchimento. Ordenadas da mais recente para a mais antiga.
 */
function epocasDosDados_(dados, mesInicioEpoca) {
  var vistas = {};
  function registar(data) {
    var e = calcularEpoca_(data, mesInicioEpoca);
    if (e) vistas[e] = true;
  }
  dados.apostas.forEach(function (p) { registar(p.data); });
  dados.multaFaltas.forEach(function (f) { registar(f.data); });
  dados.levantamentos.forEach(function (l) { registar(l.data); });
  return Object.keys(vistas).sort().reverse();
}

function mediana_(valores) {
  if (!valores || valores.length === 0) return null;
  var v = valores.slice().sort(function (a, b) { return a - b; });
  var mid = Math.floor(v.length / 2);
  return v.length % 2 === 0 ? (v[mid - 1] + v[mid]) / 2 : v[mid];
}

function media_(valores) {
  if (!valores || valores.length === 0) return null;
  var soma = valores.reduce(function (a, b) { return a + b; }, 0);
  return soma / valores.length;
}

function lookupMultaErros_(config, nErrantes) {
  var tabela = config.multaErros;
  for (var i = 0; i < tabela.length; i++) {
    if (tabela[i].nErrantes === nErrantes) return tabela[i];
  }
  return tabela[tabela.length - 1];
}

function lookupMultaAtraso_(config, contagem) {
  var tabela = config.multaAtrasos;
  var maxN = tabela[tabela.length - 1].n;
  var alvo = Math.min(contagem, maxN);
  for (var i = 0; i < tabela.length; i++) {
    if (tabela[i].n === alvo) return tabela[i];
  }
  return tabela[tabela.length - 1];
}

function lookupMultaFalta_(config, contagem) {
  var tabela = config.multaFaltas;
  var maxN = tabela[tabela.length - 1].n;
  var alvo = Math.min(contagem, maxN);
  for (var i = 0; i < tabela.length; i++) {
    if (tabela[i].n === alvo) return tabela[i];
  }
  return tabela[tabela.length - 1];
}

/** Agrupa as pernas de Apostas por id_boletim, preservando a ordem de leitura. */
function agruparBoletins_(apostas, numJogadores) {
  var mapa = {};
  var ordem = [];
  apostas.forEach(function (perna) {
    if (!perna.idBoletim) return;
    if (!mapa[perna.idBoletim]) {
      mapa[perna.idBoletim] = { id: perna.idBoletim, pernas: [] };
      ordem.push(perna.idBoletim);
    }
    mapa[perna.idBoletim].pernas.push(perna);
  });
  return ordem.map(function (id) {
    var b = mapa[id];
    b.concluido = b.pernas.length === numJogadores && b.pernas.every(function (p) {
      return p.resultado && p.resultado !== 'Pendente';
    });
    b.data = null;
    for (var i = 0; i < b.pernas.length; i++) {
      if (b.pernas[i].data) { b.data = b.pernas[i].data; break; }
    }
    return b;
  });
}

/** Calcula odd total, estado, ganho real e nº de erros de um boletim concluído. */
function calcularResultadoBoletim_(boletim, config) {
  var odds = boletim.pernas.map(function (p) { return p.odd; });
  var prodTodas = odds.reduce(function (a, b) { return a * b; }, 1);
  var oddTotal = prodTodas * odds.reduce(function (s, o) { return s + 1 / o; }, 0);
  var ganhosPossiveis = oddTotal * config.geral.montanteCombinacao;
  var custoBoletim = config.geral.montanteCombinacao * config.geral.numeroJogadores;

  var pernasErradas = boletim.pernas.filter(function (p) { return p.resultado === 'Errou' && p.odd !== 1; });
  var nErros = pernasErradas.length;
  var estadoInfo = lookupMultaErros_(config, nErros);
  var vencedor = nErros <= 1;

  var ganhoReal;
  if (nErros === 0) {
    ganhoReal = ganhosPossiveis;
  } else if (nErros === 1) {
    var oddErrada = pernasErradas[0].odd;
    ganhoReal = (prodTodas / oddErrada) * config.geral.montanteCombinacao;
  } else {
    ganhoReal = -custoBoletim;
  }

  return {
    oddTotal: oddTotal, ganhosPossiveis: ganhosPossiveis, custoBoletim: custoBoletim,
    nErros: nErros, estado: estadoInfo.estadoLabel, vencedor: vencedor, ganhoReal: ganhoReal,
  };
}

/** Preenche _multaAtraso e _multaErro em cada perna de todos os boletins concluídos.
 * `config` é a config base (com `historicoConfig`) — a tabela de multas e a odd
 * mínima usadas em cada perna/boletim são as que estavam em vigor NA DATA desse
 * boletim (ver `configParaData_`), não a versão atual — assim uma alteração de
 * valores só afeta boletins registados a partir da data escolhida. */
function calcularMultasPorPerna_(boletinsConcluidos, config) {
  var contagemAtrasoMes = {}; // "jogador|ano|mes" -> contagem
  boletinsConcluidos.forEach(function (b) {
    b.pernas.forEach(function (p) {
      if (p.atraso === 'Sim' && p.data) {
        var chave = p.jogador + '|' + p.data.getFullYear() + '|' + p.data.getMonth();
        contagemAtrasoMes[chave] = (contagemAtrasoMes[chave] || 0) + 1;
        p._multaAtraso = lookupMultaAtraso_(configParaData_(config, p.data), contagemAtrasoMes[chave]).multa;
      } else {
        p._multaAtraso = 0;
      }
    });
  });

  boletinsConcluidos.forEach(function (b) {
    var configBoletim = configParaData_(config, b.data);
    var multaIndividualErro = lookupMultaErros_(configBoletim, b._resultado.nErros).multaIndividual;
    b.pernas.forEach(function (p) {
      if (p.resultado === 'Errou' && p.odd !== 1) {
        p._multaErro = multaIndividualErro * (p.odd < configBoletim.geral.oddMinima ? 2 : 1);
      } else {
        p._multaErro = 0;
      }
      p._multaTotal = p._multaAtraso + p._multaErro;
    });
    b._multasBoletim = b.pernas.reduce(function (s, p) { return s + p._multaTotal; }, 0);
    b._lucro = b._resultado.ganhoReal - (b._resultado.vencedor ? b._resultado.custoBoletim : 0) + b._multasBoletim;
  });
}

/** Idem: a tabela `Config_MultaFaltas` usada é a que estava em vigor na data de
 * cada falta, não a atual. */
function calcularMultasFaltas_(multaFaltas, config) {
  var ordenadas = multaFaltas.slice().sort(function (a, b) { return a.data - b.data; });
  var contagemMes = {};
  ordenadas.forEach(function (f) {
    var chave = f.jogador + '|' + f.data.getFullYear() + '|' + f.data.getMonth();
    contagemMes[chave] = (contagemMes[chave] || 0) + 1;
    f._nFalta = contagemMes[chave];
    f._multa = lookupMultaFalta_(configParaData_(config, f.data), f._nFalta).multa;
  });
  return ordenadas;
}

function correlacaoPearson_(xs, ys) {
  var pares = [];
  for (var i = 0; i < xs.length; i++) {
    if (xs[i] !== null && ys[i] !== null) pares.push([xs[i], ys[i]]);
  }
  if (pares.length < 2) return null;
  var mx = media_(pares.map(function (p) { return p[0]; }));
  var my = media_(pares.map(function (p) { return p[1]; }));
  var num = 0, dx2 = 0, dy2 = 0;
  pares.forEach(function (p) {
    var dx = p[0] - mx, dy = p[1] - my;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  });
  if (dx2 === 0 || dy2 === 0) return null;
  return num / Math.sqrt(dx2 * dy2);
}

/**
 * Rollups por jogador que DEPENDEM da época (classificação, performance
 * individual, multas, desporto, correlação) — recebem já os boletins/faltas
 * filtrados pela época pedida (ou todos, para "Todas"). Chamada uma vez por
 * época dentro de `fatiaEpoca_`: é barata (só percorre o que já foi filtrado),
 * a parte cara é `calcularResultadoBoletim_`/`calcularMultasPorPerna_`, essas
 * sim feitas uma única vez em `computarBase_` sobre TODOS os boletins.
 */
function rollupsPorJogador_(concluidos, multaFaltas, config) {
  var jogadores = config.jogadores;
  var estadoSeq = {}, perf = {}, multasJog = {}, desportoIndiv = {}, acertoSeries = {};
  jogadores.forEach(function (j) {
    estadoSeq[j] = { seqAtual: 0, maxVit: 0, maxDer: 0 };
    perf[j] = { totalApostas: 0, totalAcertos: 0, odds: [], oddsAcerto: [], oddsErro: [], maiorOddAcertada: 0 };
    multasJog[j] = { nAtrasos: 0, multaAtraso: 0, nErros: 0, multaErro: 0, nFaltas: 0, multaFalta: 0, pendentes: 0 };
    desportoIndiv[j] = {};
    acertoSeries[j] = [];
  });
  var desportoGlobal = {};
  config.desportos.forEach(function (d) { desportoGlobal[d] = { nApostas: 0, nAcertos: 0, odds: [] }; });

  concluidos.forEach(function (b) {
    var flags = {};
    b.pernas.forEach(function (p) {
      flags[p.jogador] = p.resultado === 'Acertou' ? 1 : (p.resultado === 'Errou' ? 0 : null);
    });
    jogadores.forEach(function (j) {
      var f = flags.hasOwnProperty(j) ? flags[j] : null;
      acertoSeries[j].push(f);
      if (f === null) return;
      var st = estadoSeq[j];
      st.seqAtual = f === 1 ? (st.seqAtual > 0 ? st.seqAtual + 1 : 1) : (st.seqAtual < 0 ? st.seqAtual - 1 : -1);
      st.maxVit = Math.max(st.maxVit, st.seqAtual > 0 ? st.seqAtual : 0);
      st.maxDer = Math.max(st.maxDer, st.seqAtual < 0 ? -st.seqAtual : 0);
    });
    b.pernas.forEach(function (p) {
      var pf = perf[p.jogador]; if (!pf) return;
      pf.totalApostas++;
      if (p.odd != null) pf.odds.push(p.odd);
      if (p.resultado === 'Acertou') {
        pf.totalAcertos++;
        if (p.odd != null) { pf.oddsAcerto.push(p.odd); pf.maiorOddAcertada = Math.max(pf.maiorOddAcertada, p.odd); }
      }
      if (p.resultado === 'Errou' && p.odd != null) pf.oddsErro.push(p.odd);

      var mj = multasJog[p.jogador]; if (!mj) return;
      if (p.atraso === 'Sim') { mj.nAtrasos++; mj.multaAtraso += p._multaAtraso; }
      if (p.resultado === 'Errou' && p.odd !== 1) { mj.nErros++; mj.multaErro += p._multaErro; }
      // Pendente = tudo o que NÃO está explicitamente "Pago" (boletins novos
      // ficam com `pago` em branco, não "Por Pagar" — só passam a "Pago"
      // depois de alguém marcar via marcarPago_; até lá contam como por pagar).
      if (p.pago !== 'Pago') mj.pendentes += p._multaTotal;

      if (p.desporto && desportoGlobal[p.desporto]) {
        var dg = desportoGlobal[p.desporto];
        dg.nApostas++; if (p.odd != null) dg.odds.push(p.odd); if (p.resultado === 'Acertou') dg.nAcertos++;
      }
      if (p.desporto) {
        var di = desportoIndiv[p.jogador][p.desporto] || (desportoIndiv[p.jogador][p.desporto] = { nApostas: 0, nAcertos: 0 });
        di.nApostas++; if (p.resultado === 'Acertou') di.nAcertos++;
      }
    });
  });

  multaFaltas.forEach(function (f) {
    var mj = multasJog[f.jogador]; if (!mj) return;
    mj.nFaltas++; mj.multaFalta += f._multa;
    if (f.estado !== 'Pago') mj.pendentes += f._multa;
  });

  var performanceIndividual = jogadores.map(function (j) {
    var pf = perf[j], st = estadoSeq[j];
    return {
      jogador: j,
      totalApostas: pf.totalApostas,
      totalAcertos: pf.totalAcertos,
      taxaAcerto: pf.totalApostas ? pf.totalAcertos / pf.totalApostas : 0,
      oddMediana: mediana_(pf.odds),
      oddMedianaAcerto: mediana_(pf.oddsAcerto),
      oddMedianaErro: mediana_(pf.oddsErro),
      maiorOddAcertada: pf.maiorOddAcertada,
      seqMaxVitorias: st.maxVit,
      seqMaxDerrotas: st.maxDer,
      seqAtual: st.seqAtual,
    };
  });

  var multasPorJogador = jogadores.map(function (j) {
    var mj = multasJog[j];
    return {
      jogador: j, nAtrasos: mj.nAtrasos, multaAtraso: mj.multaAtraso, nErros: mj.nErros,
      multaErro: mj.multaErro, nFaltas: mj.nFaltas, multaFalta: mj.multaFalta,
      totalMultas: mj.multaAtraso + mj.multaErro + mj.multaFalta, pendentes: mj.pendentes,
    };
  });

  var multasPorTipo = [
    { tipo: 'Atraso', valor: multasPorJogador.reduce(function (s, m) { return s + m.multaAtraso; }, 0) },
    { tipo: 'Erro Prognóstico', valor: multasPorJogador.reduce(function (s, m) { return s + m.multaErro; }, 0) },
    { tipo: 'Falta de Prognóstico', valor: multasPorJogador.reduce(function (s, m) { return s + m.multaFalta; }, 0) },
  ];

  var performanceDesporto = config.desportos.map(function (d) {
    var dg = desportoGlobal[d];
    return {
      desporto: d, nApostas: dg.nApostas, nAcertos: dg.nAcertos,
      taxaAcerto: dg.nApostas ? dg.nAcertos / dg.nApostas : 0, oddMedia: media_(dg.odds),
    };
  });

  var performanceDesportoIndividual = jogadores.map(function (j) {
    var linha = { jogador: j };
    config.desportos.forEach(function (d) {
      var di = desportoIndiv[j][d];
      linha[d] = di && di.nApostas ? di.nAcertos / di.nApostas : null;
    });
    return linha;
  });

  var correlacao = jogadores.map(function (j1) {
    var linha = { jogador: j1 };
    jogadores.forEach(function (j2) {
      linha[j2] = j1 === j2 ? 1 : correlacaoPearson_(acertoSeries[j1], acertoSeries[j2]);
    });
    return linha;
  });

  function argExtremo(lista, campo, maior) {
    if (lista.length === 0) return null;
    return lista.reduce(function (best, cur) {
      if (!best) return cur;
      return (maior ? cur[campo] > best[campo] : cur[campo] < best[campo]) ? cur : best;
    }, null);
  }

  function classItem(categoria, item, campo) {
    return item ? { categoria: categoria, jogador: item.jogador, valor: item[campo] } : { categoria: categoria, jogador: null, valor: null };
  }

  var classificacao = [
    classItem('Maior Taxa de Acerto', argExtremo(performanceIndividual, 'taxaAcerto', true), 'taxaAcerto'),
    classItem('Maior Odd Acertada', argExtremo(performanceIndividual, 'maiorOddAcertada', true), 'maiorOddAcertada'),
    classItem('Maior Sequência de Vitórias', argExtremo(performanceIndividual, 'seqMaxVitorias', true), 'seqMaxVitorias'),
    classItem('Maior Sequência de Derrotas', argExtremo(performanceIndividual, 'seqMaxDerrotas', true), 'seqMaxDerrotas'),
    classItem('Maior Assiduidade', argExtremo(multasPorJogador, 'nAtrasos', false), 'nAtrasos'),
    classItem('Pior Assiduidade', argExtremo(multasPorJogador, 'nAtrasos', true), 'nAtrasos'),
    classItem('Maior Contribuição em Multas', argExtremo(multasPorJogador, 'totalMultas', true), 'totalMultas'),
  ];

  return {
    performanceIndividual: performanceIndividual,
    multasPorJogador: multasPorJogador,
    multasPorTipo: multasPorTipo,
    performanceDesporto: performanceDesporto,
    performanceDesportoIndividual: performanceDesportoIndividual,
    correlacao: correlacao,
    classificacao: classificacao,
  };
}

/**
 * Passagem única sobre os dados: agrupa boletins, calcula resultados/multas e
 * a série global da banca — a parte cara que NÃO depende da época (é feita
 * sobre TODOS os boletins uma única vez). Os rollups por jogador (que agora
 * dependem da época) são calculados depois, por época, em `fatiaEpoca_`.
 */
function computarBase_(dados) {
  var config = dados.config;
  var mesInicio = config.geral.mesInicioEpoca;

  var boletins = agruparBoletins_(dados.apostas, config.geral.numeroJogadores);
  var concluidos = boletins.filter(function (b) { return b.concluido && b.data; });
  concluidos.sort(function (a, b) { return a.data - b.data; });
  concluidos.forEach(function (b) { b._resultado = calcularResultadoBoletim_(b, configParaData_(config, b.data)); });
  calcularMultasPorPerna_(concluidos, config);

  var multaFaltas = calcularMultasFaltas_(dados.multaFaltas, config);

  // --- Banca global e evolução ---
  var eventos = [];
  concluidos.forEach(function (b) { eventos.push({ data: b.data, delta: b._lucro, tipo: 'boletim', id: b.id }); });
  multaFaltas.forEach(function (f) { eventos.push({ data: f.data, delta: f._multa, tipo: 'multaFalta' }); });
  dados.levantamentos.forEach(function (l) { eventos.push({ data: l.data, delta: -l.valor, tipo: 'levantamento' }); });
  eventos.sort(function (a, b) {
    var d = a.data - b.data;
    if (d !== 0) return d;
    return (a.tipo === 'boletim' ? 1 : 0) - (b.tipo === 'boletim' ? 1 : 0);
  });
  var banca = config.geral.bancaInicial;
  var evolucaoBanca = [];
  eventos.forEach(function (ev) {
    banca += ev.delta;
    if (ev.tipo === 'boletim') evolucaoBanca.push({ boletim: ev.id, data: ev.data, banca: banca });
  });
  var bancaAtual = banca;

  return {
    config: config,
    mesInicio: mesInicio,
    boletins: boletins,
    concluidos: concluidos,
    multaFaltas: multaFaltas,
    evolucaoBanca: evolucaoBanca,
    bancaAtual: bancaAtual,
  };
}

/**
 * Parte que DEPENDE da época: KPIs, pontos da série da banca, e todos os
 * rollups por jogador (classificação, performance individual, multas,
 * desporto, correlação) — filtrados para a época pedida. Barata — só filtra
 * e soma sobre o que `computarBase_` já calculou.
 * (Banca Atual e Total Levantado ficam sempre globais, como no Excel.)
 */
function fatiaEpoca_(base, dados, epocaFiltro) {
  var config = base.config;
  var mesInicio = base.mesInicio;
  var todasEpoca = !epocaFiltro || epocaFiltro === 'Todas';

  var concluidosFiltrados = base.concluidos.filter(function (b) {
    return todasEpoca || calcularEpoca_(b.data, mesInicio) === epocaFiltro;
  });
  var pernasFiltradas = [];
  concluidosFiltrados.forEach(function (b) { pernasFiltradas = pernasFiltradas.concat(b.pernas); });
  var multaFaltasFiltradas = base.multaFaltas.filter(function (f) {
    return todasEpoca || calcularEpoca_(f.data, mesInicio) === epocaFiltro;
  });

  var nVencedor = concluidosFiltrados.filter(function (b) { return b._resultado.vencedor; }).length;
  var kpis = {
    bancaAtual: base.bancaAtual,
    lucroTotal: concluidosFiltrados.reduce(function (s, b) { return s + b._lucro; }, 0),
    totalLevantado: dados.levantamentos.reduce(function (s, l) { return s + l.valor; }, 0),
    boletinsConcluidos: concluidosFiltrados.length,
    taxaSucesso: concluidosFiltrados.length ? (nVencedor / concluidosFiltrados.length) * config.geral.numeroJogadores : 0,
    oddMedia: media_(pernasFiltradas.map(function (p) { return p.odd; }).filter(function (o) { return o != null; })),
    multasTotais: pernasFiltradas.reduce(function (s, p) { return s + p._multaTotal; }, 0)
      + multaFaltasFiltradas.reduce(function (s, f) { return s + f._multa; }, 0),
    multasPendentes: pernasFiltradas.filter(function (p) { return p.pago !== 'Pago'; })
      .reduce(function (s, p) { return s + p._multaTotal; }, 0)
      + multaFaltasFiltradas.filter(function (f) { return f.estado !== 'Pago'; }).reduce(function (s, f) { return s + f._multa; }, 0),
    multasFaltaPick: multaFaltasFiltradas.reduce(function (s, f) { return s + f._multa; }, 0),
    nFaltasRegistadas: multaFaltasFiltradas.length,
  };

  var evolucaoBancaFiltrada = base.evolucaoBanca.filter(function (pt) {
    return todasEpoca || calcularEpoca_(pt.data, mesInicio) === epocaFiltro;
  });

  var rollups = rollupsPorJogador_(concluidosFiltrados, multaFaltasFiltradas, config);

  return {
    kpis: kpis,
    evolucaoBanca: evolucaoBancaFiltrada.map(function (pt) {
      return { boletim: pt.boletim, data: pt.data.toISOString().slice(0, 10), banca: pt.banca };
    }),
    // Lista "crua" das faltas de prognóstico (não só a soma) — para o frontend
    // conseguir listar cada uma com um botão "Marcar como pago" (linha aponta
    // para a linha real em MultaFaltas, usada por `?action=marcarPago`).
    faltas: multaFaltasFiltradas.map(function (f) {
      return {
        data: f.data.toISOString().slice(0, 10), jogador: f.jogador, motivo: f.motivo || '',
        estado: f.estado, multa: f._multa, linha: f.linha,
      };
    }).sort(function (a, b) { return b.data.localeCompare(a.data); }),
    classificacao: rollups.classificacao,
    performanceIndividual: rollups.performanceIndividual,
    multasPorJogador: rollups.multasPorJogador,
    multasPorTipo: rollups.multasPorTipo,
    performanceDesporto: rollups.performanceDesporto,
    performanceDesportoIndividual: rollups.performanceDesportoIndividual,
    correlacao: rollups.correlacao,
  };
}

/**
 * Histórico de boletins, do mais recente para o mais antigo. Inclui os
 * PENDENTES (que não entram em nenhum cálculo) para se ver o que falta fechar,
 * mas ignora os resíduos vazios da migração do Excel — linhas placeholder sem
 * data e sem nenhum dado preenchido em nenhuma perna. Um boletim registado pela
 * app tem sempre data (campo obrigatório do formulário), por isso este filtro
 * nunca esconde um pendente real.
 * Cada boletim traz já a sua época, para o frontend filtrar sem recalcular.
 */
function historicoBoletins_(base) {
  var comDados = base.boletins.filter(function (b) { return !!b.data; });
  var ordenados = comDados.slice().sort(function (a, b) {
    var da = a.data ? a.data.getTime() : 0;
    var db = b.data ? b.data.getTime() : 0;
    if (db !== da) return db - da;
    return String(b.id).localeCompare(String(a.id));
  });

  return ordenados.map(function (b) {
    var r = b.concluido ? b._resultado : null;
    return {
      id: b.id,
      data: b.data ? b.data.toISOString().slice(0, 10) : '',
      epoca: calcularEpoca_(b.data, base.mesInicio),
      tipoJornada: (b.pernas[0] && b.pernas[0].tipoJornada) || '',
      concluido: !!r,
      estado: r ? r.estado : 'Pendente',
      vencedor: r ? r.vencedor : null,
      nErros: r ? r.nErros : null,
      oddTotal: r ? r.oddTotal : null,
      ganhoReal: r ? r.ganhoReal : null,
      multasBoletim: r ? b._multasBoletim : null,
      lucro: r ? b._lucro : null,
      pernas: b.pernas.map(function (p) {
        return {
          jogador: p.jogador,
          desporto: p.desporto,
          partida: p.partida,
          prognostico: p.prognostico,
          odd: p.odd,
          atraso: p.atraso,
          resultado: p.resultado,
          pago: p.pago,
          linha: p.linha,
          // Só definidos para boletins concluídos (calcularMultasPorPerna_ só
          // corre sobre esses) — o frontend usa isto para saber se há algo por
          // pagar nesta perna e mostrar o botão "Marcar como pago".
          multaAtraso: p._multaAtraso || 0,
          multaErro: p._multaErro || 0,
        };
      }),
    };
  });
}

/**
 * Ponto de entrada do endpoint `?action=dashboard`: devolve TUDO num só payload
 * — as fatias de todas as épocas (cada uma já com kpis, banca e todos os
 * rollups por jogador filtrados), o histórico e a config. O frontend não volta
 * a pedir nada para trocar de época, só troca de `payload.porEpoca[epoca]`.
 */
function computarDashboardCompleto_(dados) {
  var base = computarBase_(dados);
  var epocas = epocasDosDados_(dados, base.mesInicio);

  var porEpoca = { 'Todas': fatiaEpoca_(base, dados, 'Todas') };
  epocas.forEach(function (e) { porEpoca[e] = fatiaEpoca_(base, dados, e); });

  return {
    epocasDisponiveis: ['Todas'].concat(epocas),
    porEpoca: porEpoca,
    historico: historicoBoletins_(base),
    config: base.config,
  };
}
