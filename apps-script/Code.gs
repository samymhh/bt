/**
 * Bet Tracker — Web App (Apps Script), ligado à Google Sheet criada na Fase 1.
 * Ver ../docs/SCHEMA.md para o desenho completo da API.
 *
 * Endpoints de leitura:
 *   GET ?action=dashboard   → payload COMPLETO: secções globais + as fatias de
 *       todas as épocas (`porEpoca`) + `historico` + `config`. Não recebe
 *       `epoca`: o frontend troca de época em memória, sem novo pedido.
 *   GET ?action=config
 *
 * Endpoints de escrita (Fase 3) — body JSON, enviado com Content-Type text/plain
 * do lado do frontend para evitar preflight CORS (Apps Script não responde a
 * OPTIONS); o corpo é sempre lido como JSON independentemente do content-type
 * declarado (ver e.postData.contents em doPost):
 *   POST { action: "registarAposta", data, tipoJornada, pernas: [...] }
 *   POST { action: "atualizarBoletim", idBoletim, data, tipoJornada, pernas: [...] }
 *       — edita um boletim que já existe, incluindo o `resultado` de cada perna.
 *         Marcar resultados aqui faz o boletim passar a "concluído", o que
 *         recalcula banca, KPIs, multas e sequências no pedido seguinte.
 *   POST { action: "registarFalta", data, jogador, motivo }
 *   POST { action: "registarLevantamento", data, motivo, valor, observacoes }
 *   POST { action: "marcarPago", sheet: "Apostas"|"MultaFaltas", linha }
 *   POST { action: "apagarBoletim", idBoletim }
 *       — apaga a sério as N linhas desse boletim em `Apostas` (não é um estado
 *         "cancelado" nem fica escondido — desaparece da Sheet). Para testar ou
 *         corrigir um registo por engano; usar com cuidado, não há undo.
 *   POST { action: "adicionarJogador", jogador }
 *   POST { action: "adicionarDesporto", desporto }
 *   POST { action: "adicionarTipoJornada", tipoJornada }
 *   POST { action: "definirValorVersionado", campo: "montante_por_combinacao"|"odd_minima",
 *          valor, vigenteDesde }
 *       — só afeta boletins com data >= vigenteDesde (ver configParaData_ em Calculo.gs).
 *   POST { action: "definirTabelaMultas", tabela: "erros"|"atrasos"|"faltas",
 *          vigenteDesde, linhas: [...] }
 *       — idem; "erros": [{nErrantes, multaIndividual, multaTotalBoletim, estadoLabel}, ...],
 *         "atrasos"/"faltas": [{n, multa}, ...].
 */

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'dashboard';
  var resposta;
  try {
    if (action === 'dashboard') {
      resposta = dashboardComCache_();
    } else if (action === 'config') {
      resposta = carregarDados_().config;
    } else {
      return jsonOutput_({ erro: 'action desconhecida: ' + action }, 400);
    }
  } catch (err) {
    return jsonOutput_({ erro: String(err && err.message || err) }, 500);
  }
  return jsonOutput_(resposta, 200);
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return jsonOutput_({ erro: 'Corpo do pedido não é JSON válido.' }, 400);
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return jsonOutput_({ erro: 'Sistema ocupado, tenta novamente.' }, 429);
  }
  try {
    var resposta;
    if (body.action === 'registarAposta') {
      resposta = registarAposta_(body);
    } else if (body.action === 'atualizarBoletim') {
      resposta = atualizarBoletim_(body);
    } else if (body.action === 'registarFalta') {
      resposta = registarFalta_(body);
    } else if (body.action === 'registarLevantamento') {
      resposta = registarLevantamento_(body);
    } else if (body.action === 'marcarPago') {
      resposta = marcarPago_(body);
    } else if (body.action === 'apagarBoletim') {
      resposta = apagarBoletim_(body);
    } else if (body.action === 'adicionarJogador') {
      resposta = adicionarJogador_(body);
    } else if (body.action === 'adicionarDesporto') {
      resposta = adicionarDesporto_(body);
    } else if (body.action === 'adicionarTipoJornada') {
      resposta = adicionarTipoJornada_(body);
    } else if (body.action === 'definirValorVersionado') {
      resposta = definirValorVersionado_(body);
    } else if (body.action === 'definirTabelaMultas') {
      resposta = definirTabelaMultas_(body);
    } else {
      return jsonOutput_({ erro: 'action desconhecida: ' + body.action }, 400);
    }
    invalidarCacheDashboard_();
    return jsonOutput_(resposta, 200);
  } catch (err) {
    return jsonOutput_({ erro: String(err && err.message || err) }, 400);
  } finally {
    lock.releaseLock();
  }
}

var CACHE_CHAVE_DASHBOARD_ = 'dashboard_v1';
var CACHE_TTL_SEGUNDOS_ = 300; // 5 min — quem partilha o link entre vários colegas beneficia mais: só o 1º pedido nesse intervalo paga o custo da leitura+cálculo completo da Sheet.

/** `?action=dashboard` a partir de uma cache partilhada (CacheService.getScriptCache
 * — a mesma cache serve TODOS os utilizadores do link, não é por pessoa). Evita
 * reler e recalcular tudo a cada abertura da app quando várias pessoas a usam. */
function dashboardComCache_() {
  var cache = CacheService.getScriptCache();
  var emCache = cache.get(CACHE_CHAVE_DASHBOARD_);
  if (emCache) return JSON.parse(emCache);

  var resposta = computarDashboardCompleto_(carregarDados_());
  try {
    cache.put(CACHE_CHAVE_DASHBOARD_, JSON.stringify(resposta), CACHE_TTL_SEGUNDOS_);
  } catch (err) {
    // Payload > 100KB (limite por chave do CacheService): segue sem cache em vez de falhar o pedido.
  }
  return resposta;
}

/** Chamada no fim de qualquer escrita bem-sucedida, para que o próximo
 * `?action=dashboard` (de qualquer utilizador) veja os dados frescos em vez de
 * esperar os até 5 min do TTL. */
function invalidarCacheDashboard_() {
  CacheService.getScriptCache().remove(CACHE_CHAVE_DASHBOARD_);
}

/** Escreve uma nova linha numa aba a partir de um objeto {nome_coluna: valor},
 * lendo o cabeçalho real da folha (não assume ordem fixa de colunas). */
function adicionarLinhaPorCabecalho_(nomeAba, objeto) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(nomeAba);
  if (!sheet) throw new Error('Aba não encontrada: ' + nomeAba);
  var cabecalho = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var linha = cabecalho.map(function (chave) {
    var v = objeto[chave];
    return v === undefined || v === null ? '' : v;
  });
  sheet.appendRow(linha);
}

function validarEnum_(valor, lista, nomeCampo) {
  if (lista.indexOf(valor) === -1) throw new Error(nomeCampo + ' inválido: "' + valor + '"');
}

function proximoIdBoletim_(apostas) {
  var max = 0;
  apostas.forEach(function (p) {
    var m = /^B(\d+)$/.exec(p.idBoletim || '');
    if (m) { var n = parseInt(m[1], 10); if (n > max) max = n; }
  });
  var s = String(max + 1);
  while (s.length < 3) s = '0' + s;
  return 'B' + s;
}

var RESULTADOS_VALIDOS_ = ['Pendente', 'Acertou', 'Errou'];

/** Validações partilhadas por registarAposta_ e atualizarBoletim_. Muta `p.atraso`
 * para normalizar (default "Não"). Se `exigirResultado`, valida também `resultado`
 * (só relevante ao editar — na criação fica sempre "Pendente"). */
function validarPernas_(pernas, config, exigirResultado) {
  if (!Array.isArray(pernas) || pernas.length !== config.geral.numeroJogadores) {
    throw new Error('É preciso exatamente ' + config.geral.numeroJogadores + ' pernas (uma por jogador).');
  }
  var jogadoresVistos = {};
  pernas.forEach(function (p) {
    validarEnum_(p.jogador, config.jogadores, 'jogador');
    if (jogadoresVistos[p.jogador]) throw new Error('Jogador repetido no boletim: ' + p.jogador);
    jogadoresVistos[p.jogador] = true;
    validarEnum_(p.desporto, config.desportos, 'desporto');
    if (!p.prognostico) throw new Error('Prognóstico em falta para ' + p.jogador + '.');
    var odd = Number(p.odd);
    if (!odd || odd < 1) throw new Error('Odd inválida para ' + p.jogador + '.');
    if (p.atraso !== 'Sim' && p.atraso !== 'Não') p.atraso = 'Não';
    if (exigirResultado) {
      validarEnum_(p.resultado || 'Pendente', RESULTADOS_VALIDOS_, 'resultado');
    }
  });
}

function registarAposta_(body) {
  var dados = carregarDados_();
  var config = dados.config;

  var dataObj = paraData_(body.data);
  if (!dataObj) throw new Error('Data inválida.');
  validarEnum_(body.tipoJornada, config.tiposJornada, 'tipoJornada');
  validarPernas_(body.pernas, config, false);

  var idBoletim = proximoIdBoletim_(dados.apostas);
  var dataIso = dataObj.toISOString().slice(0, 10);
  body.pernas.forEach(function (p) {
    adicionarLinhaPorCabecalho_('Apostas', {
      id_boletim: idBoletim,
      data: dataIso,
      tipo_jornada: body.tipoJornada,
      jogador: p.jogador,
      desporto: p.desporto,
      partida: p.partida || '',
      prognostico: p.prognostico,
      odd: Number(p.odd),
      atraso: p.atraso,
      resultado: 'Pendente',
      observacoes: p.observacoes || '',
      pago: '',
    });
  });

  return { ok: true, idBoletim: idBoletim };
}

/** Edita um boletim já existente (as suas N linhas em `Apostas`), incluindo o
 * `resultado` de cada perna — é assim que um boletim passa de Pendente a
 * concluído (ou se corrige um resultado marcado por engano). Atualiza as linhas
 * em vez de apagar/reescrever, para preservar `pago` (nunca tocado aqui — só
 * `marcarPago_` o muda) e a posição na Sheet. */
function atualizarBoletim_(body) {
  var dados = carregarDados_();
  var config = dados.config;

  var pernasExistentes = dados.apostas.filter(function (p) { return p.idBoletim === body.idBoletim; });
  if (pernasExistentes.length === 0) throw new Error('Boletim não encontrado: ' + body.idBoletim);

  var dataObj = paraData_(body.data);
  if (!dataObj) throw new Error('Data inválida.');
  validarEnum_(body.tipoJornada, config.tiposJornada, 'tipoJornada');
  validarPernas_(body.pernas, config, true);

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Apostas');
  var cabecalho = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var dataIso = dataObj.toISOString().slice(0, 10);

  body.pernas.forEach(function (p) {
    var existente = pernasExistentes.filter(function (r) { return r.jogador === p.jogador; })[0];
    if (!existente) throw new Error('O boletim ' + body.idBoletim + ' não tem uma perna para ' + p.jogador + '.');
    var valores = {
      id_boletim: body.idBoletim,
      data: dataIso,
      tipo_jornada: body.tipoJornada,
      jogador: p.jogador,
      desporto: p.desporto,
      partida: p.partida || '',
      prognostico: p.prognostico,
      odd: Number(p.odd),
      atraso: p.atraso,
      resultado: p.resultado || 'Pendente',
      observacoes: p.observacoes !== undefined ? p.observacoes : (existente.observacoes || ''),
      pago: existente.pago || '',
    };
    var linhaValores = cabecalho.map(function (chave) {
      var v = valores[chave];
      return v === undefined || v === null ? '' : v;
    });
    sheet.getRange(existente.linha, 1, 1, cabecalho.length).setValues([linhaValores]);
  });

  return { ok: true, idBoletim: body.idBoletim };
}

function registarFalta_(body) {
  var dados = carregarDados_();
  var dataObj = paraData_(body.data);
  if (!dataObj) throw new Error('Data inválida.');
  validarEnum_(body.jogador, dados.config.jogadores, 'jogador');
  adicionarLinhaPorCabecalho_('MultaFaltas', {
    data: dataObj.toISOString().slice(0, 10),
    jogador: body.jogador,
    motivo: body.motivo || '',
    estado: 'Por Pagar',
  });
  return { ok: true };
}

function registarLevantamento_(body) {
  var dataObj = paraData_(body.data);
  if (!dataObj) throw new Error('Data inválida.');
  var valor = Number(body.valor);
  if (!valor || valor <= 0) throw new Error('Valor inválido.');
  adicionarLinhaPorCabecalho_('Levantamentos', {
    data: dataObj.toISOString().slice(0, 10),
    motivo: body.motivo || '',
    valor: valor,
    observacoes: body.observacoes || '',
  });
  return { ok: true };
}

function adicionarJogador_(body) {
  var jogador = String(body.jogador || '').trim();
  if (!jogador) throw new Error('Nome de jogador em falta.');
  var atuais = lerSheetComoObjetos_('Config_Jogadores').map(function (r) { return r.jogador; });
  if (atuais.indexOf(jogador) !== -1) throw new Error('Já existe um jogador com esse nome.');
  adicionarLinhaPorCabecalho_('Config_Jogadores', { jogador: jogador });
  return { ok: true };
}

function adicionarDesporto_(body) {
  var desporto = String(body.desporto || '').trim();
  if (!desporto) throw new Error('Nome de desporto em falta.');
  var atuais = lerSheetComoObjetos_('Config_Desportos').map(function (r) { return r.desporto; });
  if (atuais.indexOf(desporto) !== -1) throw new Error('Já existe um desporto com esse nome.');
  adicionarLinhaPorCabecalho_('Config_Desportos', { desporto: desporto });
  return { ok: true };
}

function adicionarTipoJornada_(body) {
  var tipo = String(body.tipoJornada || '').trim();
  if (!tipo) throw new Error('Tipo de jornada em falta.');
  var atuais = lerSheetComoObjetos_('Config_TiposJornada').map(function (r) { return r.tipo_jornada; });
  if (atuais.indexOf(tipo) !== -1) throw new Error('Já existe um tipo de jornada com esse nome.');
  adicionarLinhaPorCabecalho_('Config_TiposJornada', { tipo_jornada: tipo });
  return { ok: true };
}

var CAMPOS_VERSIONADOS_ = { montante_por_combinacao: true, odd_minima: true };

/** Define um novo valor para um campo numérico versionado (stake/odd mínima), em
 * vigor a partir de uma data. NUNCA edita/apaga a linha antiga — acrescenta uma
 * nova, para os boletins já registados continuarem a usar o valor histórico
 * quando o dashboard é recalculado (ver `configParaData_` em Calculo.gs). Exige
 * que `Config_Geral` já tenha a coluna `vigente_desde` (ver README). */
function definirValorVersionado_(body) {
  if (!CAMPOS_VERSIONADOS_[body.campo]) throw new Error('campo inválido: ' + body.campo);
  var valor = Number(body.valor);
  if (!valor || valor <= 0) throw new Error('Valor inválido.');
  var dataObj = paraData_(body.vigenteDesde);
  if (!dataObj) throw new Error('Data de vigência inválida.');
  adicionarLinhaPorCabecalho_('Config_Geral', {
    chave: body.campo,
    valor: valor,
    vigente_desde: dataObj.toISOString().slice(0, 10),
  });
  return { ok: true };
}

var TABELAS_MULTAS_ = {
  erros: {
    sheet: 'Config_MultaErros',
    mapear: function (l) {
      return {
        'nº_errantes': Number(l.nErrantes), multa_individual: Number(l.multaIndividual),
        multa_total_boletim: Number(l.multaTotalBoletim), estado_label: l.estadoLabel,
      };
    },
  },
  atrasos: { sheet: 'Config_MultaAtrasos', mapear: function (l) { return { 'nº_atrasos_no_mes': Number(l.n), multa: Number(l.multa) }; } },
  faltas: { sheet: 'Config_MultaFaltas', mapear: function (l) { return { 'nº_faltas_no_mes': Number(l.n), multa: Number(l.multa) }; } },
};

/** Define uma nova versão completa de uma tabela de multas (erros/atrasos/faltas),
 * em vigor a partir de uma data — acrescenta todas as linhas da tabela nova
 * (nunca edita/apaga as antigas), todas com o mesmo `vigente_desde`. Exige que a
 * respetiva aba já tenha a coluna `vigente_desde` (ver README). */
function definirTabelaMultas_(body) {
  var tabela = TABELAS_MULTAS_[body.tabela];
  if (!tabela) throw new Error('tabela inválida: ' + body.tabela);
  if (!Array.isArray(body.linhas) || body.linhas.length === 0) throw new Error('Tabela sem linhas.');
  var dataObj = paraData_(body.vigenteDesde);
  if (!dataObj) throw new Error('Data de vigência inválida.');
  var vigenteDesde = dataObj.toISOString().slice(0, 10);
  body.linhas.forEach(function (linha) {
    var objeto = tabela.mapear(linha);
    objeto.vigente_desde = vigenteDesde;
    adicionarLinhaPorCabecalho_(tabela.sheet, objeto);
  });
  return { ok: true };
}

function marcarPago_(body) {
  if (body.sheet !== 'Apostas' && body.sheet !== 'MultaFaltas') {
    throw new Error('sheet inválida: ' + body.sheet);
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(body.sheet);
  var linha = parseInt(body.linha, 10);
  if (!linha || linha < 2 || linha > sheet.getLastRow()) throw new Error('linha inválida.');
  var cabecalho = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var campo = body.sheet === 'Apostas' ? 'pago' : 'estado';
  var col = cabecalho.indexOf(campo) + 1;
  if (!col) throw new Error('Coluna ' + campo + ' não encontrada em ' + body.sheet + '.');
  sheet.getRange(linha, col).setValue('Pago');
  return { ok: true };
}

/** Apaga a SÉRIO as N linhas (uma por jogador) de um boletim em `Apostas` —
 * para testar ou corrigir um registo por engano. Não há undo (a não ser
 * restaurar pelo histórico de versões da própria Google Sheet). Não mexe em
 * nada mais (MultaFaltas, Levantamentos, Config_*). */
function apagarBoletim_(body) {
  if (!body.idBoletim) throw new Error('idBoletim em falta.');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Apostas');
  var cabecalho = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var colId = cabecalho.indexOf('id_boletim');
  if (colId < 0) throw new Error('Coluna id_boletim não encontrada.');
  var valores = sheet.getDataRange().getValues();
  var linhasParaApagar = [];
  for (var i = 1; i < valores.length; i++) {
    if (String(valores[i][colId]) === String(body.idBoletim)) linhasParaApagar.push(i + 1);
  }
  if (linhasParaApagar.length === 0) throw new Error('Boletim não encontrado: ' + body.idBoletim);
  // Apagar de baixo para cima — apagar de cima para baixo desalinha os
  // números de linha das que faltam apagar a seguir.
  linhasParaApagar.sort(function (a, b) { return b - a; });
  linhasParaApagar.forEach(function (linha) { sheet.deleteRow(linha); });
  return { ok: true, linhasApagadas: linhasParaApagar.length };
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function carregarDados_() {
  return {
    apostas: carregarApostas_(),
    multaFaltas: carregarMultaFaltas_(),
    levantamentos: carregarLevantamentos_(),
    config: carregarConfig_(),
  };
}

function lerSheetComoObjetos_(nomeAba) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(nomeAba);
  if (!sheet) return [];
  var valores = sheet.getDataRange().getValues();
  if (valores.length < 2) return [];
  var cabecalho = valores[0];
  var linhas = [];
  valores.slice(1).forEach(function (linha, i) {
    if (!linha.some(function (v) { return v !== '' && v !== null; })) return;
    var obj = {};
    cabecalho.forEach(function (chave, idx) { obj[chave] = linha[idx]; });
    obj._linha = i + 2; // linha real na Sheet (1 = cabeçalho)
    linhas.push(obj);
  });
  return linhas;
}

function paraData_(valor) {
  if (!valor) return null;
  if (valor instanceof Date) return valor;
  var d = new Date(valor);
  return isNaN(d.getTime()) ? null : d;
}

function paraNumeroOuNull_(valor) {
  if (valor === '' || valor === null || valor === undefined) return null;
  var n = Number(valor);
  return isNaN(n) ? null : n;
}

function carregarApostas_() {
  return lerSheetComoObjetos_('Apostas').map(function (r) {
    return {
      idBoletim: r.id_boletim,
      data: paraData_(r.data),
      tipoJornada: r.tipo_jornada,
      jogador: r.jogador,
      desporto: r.desporto,
      partida: r.partida,
      prognostico: r.prognostico,
      odd: paraNumeroOuNull_(r.odd),
      atraso: r.atraso,
      resultado: r.resultado,
      observacoes: r.observacoes,
      pago: r.pago,
      linha: r._linha,
    };
  });
}

function carregarMultaFaltas_() {
  return lerSheetComoObjetos_('MultaFaltas').map(function (r) {
    return { data: paraData_(r.data), jogador: r.jogador, motivo: r.motivo, estado: r.estado, linha: r._linha };
  }).filter(function (r) { return r.data && r.jogador; });
}

function carregarLevantamentos_() {
  return lerSheetComoObjetos_('Levantamentos').map(function (r) {
    return { data: paraData_(r.data), motivo: r.motivo, valor: paraNumeroOuNull_(r.valor) || 0, observacoes: r.observacoes };
  }).filter(function (r) { return r.data; });
}

/** Agrupa as linhas de uma "chave" de Config_Geral (ex: montante_por_combinacao)
 * pelas suas datas de vigência (`vigente_desde`, opcional) — cada valor com uma
 * data diferente é uma versão; sem data = versão base. Devolve ordenado da mais
 * antiga para a mais recente (ver `configParaData_` em Calculo.gs). */
function versoesDeChave_(geralRows, chave) {
  var linhas = geralRows.filter(function (r) { return r.chave === chave; });
  var versoes = linhas.map(function (r) {
    return { vigenteDesde: paraData_(r.vigente_desde), valor: Number(r.valor) };
  });
  return ordenarVersoes_(versoes);
}

/** Idem, mas para uma tabela inteira (Config_MultaErros/Atrasos/Faltas): todas as
 * linhas com o mesmo `vigente_desde` formam uma versão (a tabela completa nessa
 * data). `mapearLinha` converte cada linha da Sheet no objeto usado pelo cálculo. */
function versoesDeTabela_(linhas, mapearLinha) {
  var grupos = [];
  var indicePorChave = {};
  linhas.forEach(function (r) {
    var data = paraData_(r.vigente_desde);
    var chave = data ? data.getTime() : 'base';
    if (!(chave in indicePorChave)) {
      indicePorChave[chave] = grupos.length;
      grupos.push({ vigenteDesde: data, valor: [] });
    }
    grupos[indicePorChave[chave]].valor.push(mapearLinha(r));
  });
  return ordenarVersoes_(grupos);
}

function ordenarVersoes_(versoes) {
  return versoes.sort(function (a, b) {
    var da = a.vigenteDesde ? a.vigenteDesde.getTime() : -Infinity;
    var db = b.vigenteDesde ? b.vigenteDesde.getTime() : -Infinity;
    return da - db;
  });
}

function ultimaVersao_(versoes, valorOmissao) {
  return versoes.length ? versoes[versoes.length - 1].valor : valorOmissao;
}

/**
 * Config completa. `montanteCombinacao`, `oddMinima` e as 3 tabelas de multas são
 * campos VERSIONADOS por data — `geral.montanteCombinacao`/`geral.oddMinima`/
 * `multaErros`/`multaAtrasos`/`multaFaltas` aqui devolvidos são sempre a versão
 * MAIS RECENTE (para formulários e validação de escrita); o histórico completo
 * de cada um (para o dashboard recalcular cada boletim com a versão em vigor na
 * sua data, e para a página de Configurações mostrar/editar) vai em
 * `historicoConfig` — ver `configParaData_` em Calculo.gs.
 */
function carregarConfig_() {
  var geralRows = lerSheetComoObjetos_('Config_Geral');
  var geralMap = {};
  geralRows.forEach(function (r) {
    if (r.chave !== 'montante_por_combinacao' && r.chave !== 'odd_minima') geralMap[r.chave] = r.valor;
  });

  var historicoConfig = {
    montanteCombinacao: versoesDeChave_(geralRows, 'montante_por_combinacao'),
    oddMinima: versoesDeChave_(geralRows, 'odd_minima'),
    multaErros: versoesDeTabela_(lerSheetComoObjetos_('Config_MultaErros'), function (r) {
      return {
        nErrantes: Number(r['nº_errantes']), multaIndividual: Number(r.multa_individual),
        multaTotalBoletim: Number(r.multa_total_boletim), estadoLabel: r.estado_label,
      };
    }),
    multaAtrasos: versoesDeTabela_(lerSheetComoObjetos_('Config_MultaAtrasos'), function (r) {
      return { n: Number(r['nº_atrasos_no_mes']), multa: Number(r.multa) };
    }),
    multaFaltas: versoesDeTabela_(lerSheetComoObjetos_('Config_MultaFaltas'), function (r) {
      return { n: Number(r['nº_faltas_no_mes']), multa: Number(r.multa) };
    }),
  };
  historicoConfig.multaErros.forEach(function (v) { v.valor.sort(function (a, b) { return a.nErrantes - b.nErrantes; }); });
  historicoConfig.multaAtrasos.forEach(function (v) { v.valor.sort(function (a, b) { return a.n - b.n; }); });
  historicoConfig.multaFaltas.forEach(function (v) { v.valor.sort(function (a, b) { return a.n - b.n; }); });

  return {
    geral: {
      bancaInicial: Number(geralMap.banca_inicial) || 0,
      montanteCombinacao: ultimaVersao_(historicoConfig.montanteCombinacao, 0),
      lucroMinimo: Number(geralMap.lucro_minimo) || 0,
      numeroJogadores: Number(geralMap.numero_jogadores) || 0,
      oddMinima: ultimaVersao_(historicoConfig.oddMinima, 0),
      mesInicioEpoca: Number(geralMap.mes_inicio_epoca) || 7,
    },
    jogadores: lerSheetComoObjetos_('Config_Jogadores').map(function (r) { return r.jogador; }),
    tiposJornada: lerSheetComoObjetos_('Config_TiposJornada').map(function (r) { return r.tipo_jornada; }),
    desportos: lerSheetComoObjetos_('Config_Desportos').map(function (r) { return r.desporto; }),
    // As épocas NÃO se leem de Config_Epocas: são derivadas das datas reais dos
    // dados em epocasDosDados_ (Calculo.gs). A aba fica na Sheet mas é ignorada.
    multaErros: ultimaVersao_(historicoConfig.multaErros, []),
    multaAtrasos: ultimaVersao_(historicoConfig.multaAtrasos, []),
    multaFaltas: ultimaVersao_(historicoConfig.multaFaltas, []),
    historicoConfig: historicoConfig,
  };
}
