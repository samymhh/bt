(function () {
  'use strict';

  var API_URL = window.BET_TRACKER_API_URL;
  var SERIES = ['--series-1', '--series-2', '--series-3', '--series-4', '--series-5', '--series-6', '--series-7', '--series-8'];

  var estadoEl = document.getElementById('estado');
  var estadoHistEl = document.getElementById('estado-historico');
  var epocaSelect = document.getElementById('epoca-select');
  var chartBanca = null;
  var chartMultasTipo = null;

  // Payload completo em memória. Trocar de época NÃO faz pedido ao servidor —
  // as fatias de todas as épocas já vêm calculadas em payload.porEpoca.
  var payload = null;

  var linkExportar = document.getElementById('link-exportar');
  if (linkExportar && window.BET_TRACKER_SHEET_ID) {
    linkExportar.href = 'https://docs.google.com/spreadsheets/d/' + window.BET_TRACKER_SHEET_ID + '/export?format=xlsx';
  }

  // --- Tema (claro/escuro) --- por omissão segue o SO; o botão força uma escolha,
  // guardada em localStorage. Corre já aqui (antes dos primeiros renders) para não
  // haver flash de tema errado.
  (function () {
    var TEMA_KEY = 'bt_tema';
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;

    function guardado() {
      try { return window.localStorage.getItem(TEMA_KEY); } catch (e) { return null; }
    }
    function efetivo() {
      var g = guardado();
      if (g === 'light' || g === 'dark') return g;
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    function aplicar(tema) {
      document.documentElement.setAttribute('data-theme', tema);
      btn.textContent = tema === 'dark' ? '☀️' : '🌙';
      btn.title = tema === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro';
    }

    aplicar(efetivo());
    btn.addEventListener('click', function () {
      var novo = efetivo() === 'dark' ? 'light' : 'dark';
      try { window.localStorage.setItem(TEMA_KEY, novo); } catch (e) { /* modo privado, etc. */ }
      aplicar(novo);
    });
  })();

  // Resolvida quando a config chega (dentro do payload) — só na 1ª vez (uma
  // Promise só resolve uma vez). js/registar.js usa-a para popular os dropdowns
  // no arranque sem fazer um 2º pedido.
  var resolverConfig, rejeitarConfig;
  var configPronta = new Promise(function (res, rej) { resolverConfig = res; rejeitarConfig = rej; });

  // Ao contrário de configPronta, isto dispara em TODOS os carregamentos
  // (incluindo o 1º) — usado por js/config-page.js, que precisa de ver a config
  // mais recente sempre que algo é adicionado/alterado lá, não só no arranque.
  var ouvintesConfig = [];
  function aoAtualizarConfig(cb) { ouvintesConfig.push(cb); }

  function corSerie(i) {
    return getComputedStyle(document.documentElement).getPropertyValue(SERIES[i % SERIES.length]).trim();
  }

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function fmtEuro(v) {
    if (v === null || v === undefined || isNaN(v)) return '—';
    return v.toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' });
  }
  function fmtEuroSinal(v) {
    if (v === null || v === undefined || isNaN(v)) return '—';
    return (v > 0 ? '+' : '') + fmtEuro(v);
  }
  function fmtPct(v) {
    if (v === null || v === undefined || isNaN(v)) return '—';
    return (v * 100).toLocaleString('pt-PT', { maximumFractionDigits: 1 }) + '%';
  }
  function fmtNum(v, casas) {
    if (v === null || v === undefined || isNaN(v)) return '—';
    return v.toLocaleString('pt-PT', { maximumFractionDigits: casas === undefined ? 2 : casas });
  }
  function fmtData(iso) {
    if (!iso) return '—';
    var p = iso.split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso;
  }

  function mostrarSeccoes() {
    ['secao-kpis', 'secao-banca', 'secao-classificacao', 'secao-individual',
      'secao-multas', 'secao-desporto', 'secao-correlacao', 'secao-historico'].forEach(function (id) {
      document.getElementById(id).hidden = false;
    });
  }

  function definirEstado(texto, erro) {
    [estadoEl, estadoHistEl].forEach(function (el) {
      el.hidden = texto === null;
      el.classList.toggle('erro', !!erro);
      if (texto !== null) el.textContent = texto;
    });
  }

  // Stale-while-revalidate: guarda o último payload bem-sucedido no localStorage
  // (por browser/dispositivo) para a próxima abertura mostrar dados de imediato
  // em vez do ecrã "A carregar dados...", enquanto os dados frescos vêm a caminho
  // em segundo plano.
  // "v2": incrementar sempre que o FORMATO do payload mudar (ex: campos que
  // passaram de globais a por-época) — uma cópia guardada com o formato
  // anterior deixa de bater certo com o que o resto do código espera e o
  // localStorage.getItem simplesmente não a encontra (chave nova), forçando
  // um pedido fresco em vez de tentar reaproveitar dados incompatíveis.
  var CACHE_KEY_DASHBOARD_ = 'bt_dashboard_cache_v2';

  function lerCacheDashboard_() {
    try {
      var bruto = window.localStorage.getItem(CACHE_KEY_DASHBOARD_);
      return bruto ? JSON.parse(bruto) : null;
    } catch (e) { return null; }
  }
  function guardarCacheDashboard_(dados) {
    try { window.localStorage.setItem(CACHE_KEY_DASHBOARD_, JSON.stringify(dados)); } catch (e) { /* quota/modo privado: ignora */ }
  }

  function aplicarPayload_(dados) {
    payload = dados;
    resolverConfig(dados.config);
    ouvintesConfig.forEach(function (cb) {
      try { cb(dados.config); } catch (e) { console.error('Erro num ouvinte de config:', e); }
    });
    definirEstado(null, false);
    mostrarSeccoes();
    preencherEpocas(dados.epocasDisponiveis);
    renderEpoca(epocaSelect.value);
  }

  /** Único pedido ao servidor: traz tudo (todas as épocas, histórico e config).
   * `avisarSeFalhar`: se true, uma falha de rede (mesmo já havendo cópia em
   * cache) mostra um aviso visível em vez de ficar só na consola — usado depois
   * de gravar algo (registar/editar/etc.), para nunca dar a entender que ficou
   * tudo atualizado quando a atualização pode não ter chegado a acontecer. No
   * arranque normal (sem escrita nenhuma), uma falha assim mantém-se silenciosa
   * e mostra os dados guardados, sem alarmar por causa de uma rede instável. */
  function carregarTudo(avisarSeFalhar) {
    var emCache = lerCacheDashboard_();
    if (emCache) {
      aplicarPayload_(emCache);
    } else {
      definirEstado('A carregar dados...', false);
    }
    return fetch(API_URL + '?action=dashboard')
      .then(function (r) { return r.json(); })
      .then(function (dados) {
        if (dados.erro) throw new Error(dados.erro);
        aplicarPayload_(dados);
        guardarCacheDashboard_(dados);
      })
      .catch(function (err) {
        if (emCache) {
          console.error('Não foi possível atualizar dados frescos — a manter a última cópia guardada.', err);
          if (avisarSeFalhar) {
            definirEstado('⚠️ A gravação foi feita, mas não foi possível confirmar que os dados no ecrã já estão atualizados (' + err.message + '). Recarrega a página para confirmar.', true);
          }
          return;
        }
        definirEstado('Não foi possível carregar os dados: ' + err.message, true);
        rejeitarConfig(err);
      });
  }

  /** Chamado depois de qualquer escrita (registar/editar/marcar pago/etc.) —
   * ver nota em `carregarTudo` sobre `avisarSeFalhar`. */
  function refresh() { return carregarTudo(true); }

  /** Mantém a época escolhida se ela continuar a existir depois de um refresh. */
  function preencherEpocas(epocas) {
    var anterior = epocaSelect.value;
    epocaSelect.innerHTML = '';
    (epocas || ['Todas']).forEach(function (ep) {
      var opt = document.createElement('option');
      opt.value = ep; opt.textContent = ep;
      epocaSelect.appendChild(opt);
    });
    epocaSelect.value = epocas.indexOf(anterior) >= 0 ? anterior : 'Todas';
  }

  /** TUDO no dashboard segue o filtro de época (exceto Banca Atual/Total
   * Levantado nos KPIs, que ficam sempre globais — tal como no Excel original).
   * Puro trabalho em memória, sem rede: as fatias de todas as épocas já vêm
   * calculadas em payload.porEpoca. */
  function renderEpoca(epoca) {
    if (!payload) return;
    var fatia = payload.porEpoca[epoca] || payload.porEpoca['Todas'];
    // Cada secção isolada num try/catch: se uma falhar (ex: payload num
    // formato inesperado), as outras — Histórico incluído — continuam a
    // renderizar em vez de o ecrã inteiro ficar vazio por causa de uma só.
    [
      function () { renderKpis(fatia.kpis); },
      function () { renderBanca(fatia.evolucaoBanca); },
      function () { renderClassificacao(fatia.classificacao); },
      function () { renderIndividual(fatia.performanceIndividual); },
      function () { renderMultas(fatia.multasPorTipo, fatia.multasPorJogador); },
      function () { renderFaltas(fatia.faltas); },
      function () { renderDesporto(fatia.performanceDesporto, fatia.performanceDesportoIndividual); },
      function () { renderCorrelacao(fatia.correlacao); },
      function () { renderHistorico(payload.historico, epoca); },
    ].forEach(function (passo) {
      try { passo(); } catch (e) { console.error('Erro a renderizar uma secção do dashboard:', e); }
    });
  }

  function kpiCard(label, valor, classe, nota) {
    var div = document.createElement('div');
    div.className = 'kpi-card';
    div.innerHTML = '<div class="label">' + label + '</div><div class="value' + (classe ? ' ' + classe : '') + '">' + valor + '</div>'
      + (nota ? '<div class="kpi-nota">' + nota + '</div>' : '');
    return div;
  }

  function grupoKpis_(container, titulo, cards) {
    var wrap = document.createElement('div');
    wrap.className = 'kpi-subgrupo';
    var h = document.createElement('h3');
    h.className = 'kpi-subtitulo';
    h.textContent = titulo;
    var grid = document.createElement('div');
    grid.className = 'kpi-grid';
    cards.forEach(function (c) { grid.appendChild(c); });
    wrap.appendChild(h);
    wrap.appendChild(grid);
    container.appendChild(wrap);
  }

  function renderKpis(k) {
    var container = document.getElementById('kpi-grid');
    container.innerHTML = '';

    grupoKpis_(container, '💰 Financeiro', [
      kpiCard('Banca Atual', fmtEuro(k.bancaAtual), null, 'Todas as épocas'),
      kpiCard('Lucro Total', fmtEuro(k.lucroTotal), k.lucroTotal >= 0 ? 'positive' : 'negative'),
      kpiCard('Total Levantado', fmtEuro(k.totalLevantado), null, 'Todas as épocas'),
    ]);

    grupoKpis_(container, '🎯 Desempenho', [
      kpiCard('Boletins Concluídos', fmtNum(k.boletinsConcluidos, 0)),
      kpiCard('Taxa de Sucesso', fmtPct(k.taxaSucesso), null, '% de boletins vencedores × nº de jogadores (fórmula do Excel) — pode passar de 100%'),
      kpiCard('Odd Média', fmtNum(k.oddMedia, 2)),
    ]);

    grupoKpis_(container, '⚖️ Multas', [
      kpiCard('Multas Totais', fmtEuro(k.multasTotais)),
      kpiCard('Multas Pendentes', fmtEuro(k.multasPendentes)),
      kpiCard('Multas Falta Prognóstico', fmtEuro(k.multasFaltaPick)),
      kpiCard('Nº Faltas Registadas', fmtNum(k.nFaltasRegistadas, 0)),
    ]);
  }

  function renderBanca(pontos) {
    var ctx = document.getElementById('chart-banca').getContext('2d');
    var muted = getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim();
    var grid = getComputedStyle(document.documentElement).getPropertyValue('--gridline').trim();
    if (chartBanca) chartBanca.destroy();
    chartBanca = new Chart(ctx, {
      type: 'line',
      data: {
        labels: pontos.map(function (p) { return p.data; }),
        datasets: [{
          label: 'Banca (€)',
          data: pontos.map(function (p) { return p.banca; }),
          borderColor: corSerie(0),
          backgroundColor: corSerie(0),
          borderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 5,
          tension: 0.15,
        }],
      },
      options: {
        responsive: true,
        animation: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: function (items) { return pontos[items[0].dataIndex].boletim + ' — ' + fmtData(items[0].label); },
              label: function (item) { return 'Banca: ' + fmtEuro(item.parsed.y); },
            },
          },
        },
        scales: {
          x: { grid: { color: grid }, ticks: { color: muted, maxTicksLimit: 8 } },
          y: { grid: { color: grid }, ticks: { color: muted, callback: function (v) { return fmtEuro(v); } } },
        },
      },
    });
  }

  function renderClassificacao(lista) {
    var grid = document.getElementById('classificacao-grid');
    grid.innerHTML = '';
    var icones = {
      'Maior Taxa de Acerto': '🎯', 'Maior Odd Acertada': '🎲', 'Maior Sequência de Vitórias': '🔥',
      'Maior Sequência de Derrotas': '🥶', 'Maior Assiduidade': '🏅', 'Pior Assiduidade': '🚩',
      'Maior Contribuição em Multas': '🔴',
    };
    lista.forEach(function (item) {
      var div = document.createElement('div');
      div.className = 'classificacao-card';
      var valorFmt = item.valor === null ? '—'
        : (item.categoria.indexOf('Taxa') >= 0 ? fmtPct(item.valor)
          : (item.categoria.indexOf('Multas') >= 0 ? fmtEuro(item.valor) : fmtNum(item.valor, 2)));
      div.innerHTML = '<div class="categoria">' + (icones[item.categoria] || '') + ' ' + esc(item.categoria) + '</div>'
        + '<div class="jogador">' + esc(item.jogador || '—') + '</div>'
        + '<div class="valor">' + valorFmt + '</div>';
      grid.appendChild(div);
    });
  }

  function renderIndividual(lista) {
    var tbody = document.querySelector('#tabela-individual tbody');
    tbody.innerHTML = '';
    lista.forEach(function (p) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + esc(p.jogador) + '</td><td>' + p.totalApostas + '</td><td>' + p.totalAcertos + '</td>'
        + '<td>' + fmtPct(p.taxaAcerto) + '</td><td>' + fmtNum(p.oddMediana) + '</td>'
        + '<td>' + fmtNum(p.oddMedianaAcerto) + '</td><td>' + fmtNum(p.oddMedianaErro) + '</td>'
        + '<td>' + fmtNum(p.maiorOddAcertada) + '</td><td>' + p.seqMaxVitorias + '</td>'
        + '<td>' + p.seqMaxDerrotas + '</td><td>' + p.seqAtual + '</td>';
      tbody.appendChild(tr);
    });
  }

  function renderMultas(porTipo, porJogador) {
    var ctx = document.getElementById('chart-multas-tipo').getContext('2d');
    var textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim();
    if (chartMultasTipo) chartMultasTipo.destroy();
    chartMultasTipo = new Chart(ctx, {
      type: 'pie',
      data: {
        labels: porTipo.map(function (t) { return t.tipo; }),
        datasets: [{
          data: porTipo.map(function (t) { return t.valor; }),
          backgroundColor: porTipo.map(function (_, i) { return corSerie(i); }),
          borderColor: getComputedStyle(document.documentElement).getPropertyValue('--surface-1').trim(),
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        animation: false,
        plugins: {
          legend: { position: 'bottom', labels: { color: textColor } },
          tooltip: { callbacks: { label: function (item) { return item.label + ': ' + fmtEuro(item.parsed); } } },
        },
      },
    });

    var tbody = document.querySelector('#tabela-multas-jogador tbody');
    tbody.innerHTML = '';
    porJogador.forEach(function (m) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + esc(m.jogador) + '</td><td>' + fmtEuro(m.pendentes) + '</td><td>' + m.nAtrasos + '</td><td>' + fmtEuro(m.multaAtraso) + '</td>'
        + '<td>' + m.nErros + '</td><td>' + fmtEuro(m.multaErro) + '</td><td>' + m.nFaltas + '</td>'
        + '<td>' + fmtEuro(m.multaFalta) + '</td><td>' + fmtEuro(m.totalMultas) + '</td>';
      tbody.appendChild(tr);
    });
  }

  function renderFaltas(faltas) {
    var tbody = document.querySelector('#tabela-faltas tbody');
    tbody.innerHTML = '';
    if (!faltas || faltas.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="estado-msg">Sem faltas registadas nesta época.</td></tr>';
      return;
    }
    faltas.forEach(function (f) {
      var celulaMulta = f.estado === 'Pago'
        ? fmtEuro(f.multa) + ' <span class="badge-pago">✅ Pago</span>'
        : fmtEuro(f.multa) + ' <button type="button" class="btn-marcar-pago" data-sheet="MultaFaltas" data-linha="' + f.linha + '">💶 Marcar pago</button>';
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + fmtData(f.data) + '</td><td>' + esc(f.jogador) + '</td>'
        + '<td>' + esc(f.motivo || '—') + '</td><td>' + celulaMulta + '</td>';
      tbody.appendChild(tr);
    });
  }

  function renderDesporto(global, individual) {
    var tbodyG = document.querySelector('#tabela-desporto-global tbody');
    tbodyG.innerHTML = '';
    global.forEach(function (d) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + esc(d.desporto) + '</td><td>' + d.nApostas + '</td><td>' + d.nAcertos + '</td>'
        + '<td>' + fmtPct(d.taxaAcerto) + '</td><td>' + fmtNum(d.oddMedia) + '</td>';
      tbodyG.appendChild(tr);
    });

    var desportos = global.map(function (d) { return d.desporto; });
    var head = document.getElementById('desporto-individual-head');
    head.innerHTML = '<th>Jogador</th>' + desportos.map(function (d) { return '<th>' + esc(d) + '</th>'; }).join('');
    var tbodyI = document.querySelector('#tabela-desporto-individual tbody');
    tbodyI.innerHTML = '';
    individual.forEach(function (linha) {
      var tr = document.createElement('tr');
      var celulas = '<td>' + esc(linha.jogador) + '</td>';
      desportos.forEach(function (d) { celulas += '<td>' + (linha[d] === null ? '—' : fmtPct(linha[d])) + '</td>'; });
      tr.innerHTML = celulas;
      tbodyI.appendChild(tr);
    });
  }

  function corDivergente(v) {
    if (v === null || v === undefined || isNaN(v)) return 'transparent';
    var neg = getComputedStyle(document.documentElement).getPropertyValue('--diverging-neg').trim();
    var pos = getComputedStyle(document.documentElement).getPropertyValue('--diverging-pos').trim();
    var mid = getComputedStyle(document.documentElement).getPropertyValue('--diverging-mid').trim();
    var alpha = Math.min(Math.abs(v), 1) * 0.55;
    var base = v >= 0 ? pos : neg;
    return alpha < 0.03 ? mid : hexToRgba(base, alpha);
  }
  function hexToRgba(hex, alpha) {
    hex = hex.replace('#', '');
    var r = parseInt(hex.substring(0, 2), 16), g = parseInt(hex.substring(2, 4), 16), b = parseInt(hex.substring(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  function renderCorrelacao(matriz) {
    var jogadores = matriz.map(function (l) { return l.jogador; });
    var head = document.getElementById('correlacao-head');
    head.innerHTML = '<th>Jogador</th>' + jogadores.map(function (j) { return '<th>' + esc(j) + '</th>'; }).join('');
    var tbody = document.querySelector('#tabela-correlacao tbody');
    tbody.innerHTML = '';
    matriz.forEach(function (linha) {
      var tr = document.createElement('tr');
      var celulas = '<td>' + esc(linha.jogador) + '</td>';
      jogadores.forEach(function (j) {
        var v = j === linha.jogador ? null : linha[j];
        var texto = v === null || v === undefined ? '—' : fmtNum(v, 2);
        celulas += '<td class="corr-cell" style="background:' + corDivergente(v) + '">' + texto + '</td>';
      });
      tr.innerHTML = celulas;
      tbody.appendChild(tr);
    });
  }

  // --- Histórico de boletins ---

  var ICONE_RESULTADO = { 'Acertou': '✅', 'Errou': '❌', 'Pendente': '⏳' };
  var RESULTADOS = ['Pendente', 'Acertou', 'Errou'];

  function classeEstado(b) {
    if (!b.concluido) return 'pendente';
    return b.vencedor ? 'vencedor' : 'perdedor';
  }

  function preencherSelectComValor(select, opcoes, valorAtual) {
    select.innerHTML = '';
    opcoes.forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o; opt.textContent = o;
      if (o === valorAtual) opt.selected = true;
      select.appendChild(opt);
    });
  }

  /** POST genérico para os endpoints de escrita — Content-Type text/plain evita o
   * preflight CORS que o Apps Script não sabe responder (ver apps-script/Code.gs). */
  function enviarEscrita_(action, dados) {
    return fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action: action }, dados)),
    }).then(function (r) { return r.json(); }).then(function (resp) {
      if (resp.erro) throw new Error(resp.erro);
      return resp;
    });
  }

  function fecharEdicao_(det) {
    det.querySelector('.boletim-view').hidden = false;
    det.querySelector('.btn-editar-boletim').hidden = false;
    det.querySelector('.boletim-edit-wrap').hidden = true;
  }

  function montarFormEdicao_(det, b) {
    var container = det.querySelector('.boletim-edit-wrap');
    var config = payload.config;

    var pernasHtml = b.pernas.map(function (p) {
      return '<div class="perna-row perna-row--editar" data-jogador="' + esc(p.jogador) + '">'
        + '<div class="perna-jogador">' + esc(p.jogador) + '</div>'
        + '<select class="perna-desporto"></select>'
        + '<input class="perna-partida" type="text" value="' + esc(p.partida || '') + '" placeholder="Partida / evento">'
        + '<input class="perna-prognostico" type="text" value="' + esc(p.prognostico || '') + '" required>'
        + '<input class="perna-odd" type="number" step="0.01" min="1" value="' + (p.odd != null ? p.odd : '') + '" required>'
        + '<select class="perna-resultado"></select>'
        + '<label class="perna-atraso-label"><input class="perna-atraso" type="checkbox"' + (p.atraso === 'Sim' ? ' checked' : '') + '> Atrasado?</label>'
        + '</div>';
    }).join('');

    container.innerHTML =
      '<form class="form-edicao-boletim">'
      + '<div class="form-row">'
      + '<label>Data<input type="date" class="edit-data" value="' + esc(b.data) + '" required></label>'
      + '<label>Tipo de Jornada<select class="edit-tipo-jornada" required></select></label>'
      + '</div>'
      + '<div class="pernas-grid">' + pernasHtml + '</div>'
      + '<div class="edicao-botoes">'
      + '<button type="submit">💾 Guardar alterações</button>'
      + '<button type="button" class="btn-cancelar-edicao">Cancelar</button>'
      + '</div>'
      + '<div class="form-msg"></div>'
      + '</form>';

    var form = container.querySelector('form');
    preencherSelectComValor(form.querySelector('.edit-tipo-jornada'), config.tiposJornada, b.tipoJornada);
    Array.prototype.forEach.call(form.querySelectorAll('.perna-row--editar'), function (row) {
      var perna = b.pernas.filter(function (p) { return p.jogador === row.dataset.jogador; })[0];
      preencherSelectComValor(row.querySelector('.perna-desporto'), config.desportos, perna.desporto);
      preencherSelectComValor(row.querySelector('.perna-resultado'), RESULTADOS, perna.resultado);
    });

    form.querySelector('.btn-cancelar-edicao').addEventListener('click', function () { fecharEdicao_(det); });

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var msgEl = form.querySelector('.form-msg');
      msgEl.textContent = ''; msgEl.className = 'form-msg';
      var pernas = Array.prototype.map.call(form.querySelectorAll('.perna-row--editar'), function (row) {
        return {
          jogador: row.dataset.jogador,
          desporto: row.querySelector('.perna-desporto').value,
          partida: row.querySelector('.perna-partida').value,
          prognostico: row.querySelector('.perna-prognostico').value,
          odd: Number(row.querySelector('.perna-odd').value),
          atraso: row.querySelector('.perna-atraso').checked ? 'Sim' : 'Não',
          resultado: row.querySelector('.perna-resultado').value,
        };
      });
      var btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      enviarEscrita_('atualizarBoletim', {
        idBoletim: b.id,
        data: form.querySelector('.edit-data').value,
        tipoJornada: form.querySelector('.edit-tipo-jornada').value,
        pernas: pernas,
      }).then(function () {
        window.BetTrackerApp.refresh();
      }).catch(function (err) {
        btn.disabled = false;
        msgEl.textContent = '❌ ' + err.message;
        msgEl.className = 'form-msg erro';
      });
    });
  }

  function cartaoBoletim(b) {
    var det = document.createElement('details');
    det.className = 'boletim-card estado-' + classeEstado(b);

    var lucro = b.concluido
      ? '<span class="boletim-lucro ' + (b.lucro >= 0 ? 'positive' : 'negative') + '">' + fmtEuroSinal(b.lucro) + '</span>'
      : '<span class="boletim-lucro">—</span>';

    var pernas = b.pernas.map(function (p) {
      var multaPerna = (p.multaAtraso || 0) + (p.multaErro || 0);
      var celulaMulta;
      if (!multaPerna) {
        celulaMulta = '<td>—</td>';
      } else if (p.pago === 'Pago') {
        celulaMulta = '<td>' + fmtEuro(multaPerna) + ' <span class="badge-pago">✅ Pago</span></td>';
      } else {
        celulaMulta = '<td>' + fmtEuro(multaPerna)
          + ' <button type="button" class="btn-marcar-pago" data-sheet="Apostas" data-linha="' + p.linha + '">💶 Marcar pago</button></td>';
      }
      return '<tr class="perna-' + (p.resultado === 'Acertou' ? 'ok' : (p.resultado === 'Errou' ? 'ko' : 'pend')) + '">'
        + '<td>' + (ICONE_RESULTADO[p.resultado] || '⏳') + ' ' + esc(p.jogador) + (p.atraso === 'Sim' ? ' <span title="Entregou com atraso">🕒</span>' : '') + '</td>'
        + '<td>' + esc(p.desporto) + '</td>'
        + '<td>' + esc(p.partida || '—') + '</td>'
        + '<td>' + esc(p.prognostico) + '</td>'
        + '<td>' + fmtNum(p.odd) + '</td>'
        + celulaMulta
        + '</tr>';
    }).join('');

    det.innerHTML =
      '<summary>'
      + '<span class="boletim-id">' + esc(b.id) + '</span>'
      + '<span class="boletim-data">' + fmtData(b.data) + '</span>'
      + '<span class="boletim-jornada">' + esc(b.tipoJornada || '—') + '</span>'
      + '<span class="boletim-estado">' + esc(b.estado) + '</span>'
      + lucro
      + '</summary>'
      + '<div class="boletim-detalhe">'
      + '<div class="boletim-view">'
      + (b.concluido
        ? '<div class="boletim-meta">Odd total <strong>' + fmtNum(b.oddTotal) + '</strong>'
          + ' · Ganho real <strong>' + fmtEuro(b.ganhoReal) + '</strong>'
          + ' · Multas do boletim <strong>' + fmtEuro(b.multasBoletim) + '</strong></div>'
        : '<div class="boletim-meta">Boletim por fechar — usa "Editar boletim" para marcar os resultados.</div>')
      + '<div class="table-scroll"><table class="pernas-tabela">'
      + '<thead><tr><th>Jogador</th><th>Desporto</th><th>Partida</th><th>Prognóstico</th><th>Odd</th><th>Multa</th></tr></thead>'
      + '<tbody>' + pernas + '</tbody></table></div>'
      + '</div>'
      + '<button type="button" class="btn-editar-boletim">✏️ Editar boletim</button>'
      + '<button type="button" class="btn-apagar-boletim">🗑️ Apagar boletim</button>'
      + '<div class="boletim-edit-wrap" hidden></div>'
      + '</div>';

    det.querySelector('.btn-editar-boletim').addEventListener('click', function (ev) {
      ev.preventDefault();
      var editWrap = det.querySelector('.boletim-edit-wrap');
      if (!editWrap.dataset.montado) {
        montarFormEdicao_(det, b);
        editWrap.dataset.montado = '1';
      }
      det.querySelector('.boletim-view').hidden = true;
      det.querySelector('.btn-editar-boletim').hidden = true;
      editWrap.hidden = false;
    });

    det.querySelector('.btn-apagar-boletim').addEventListener('click', function (ev) {
      ev.preventDefault();
      var btn = ev.currentTarget;
      // Apaga mesmo da Sheet (não é um "cancelado" escondido) — por isso a
      // confirmação explícita, sem forma de desfazer a partir da app.
      if (!confirm('Apagar o boletim ' + b.id + ' (' + fmtData(b.data) + ')? Isto remove-o mesmo da Sheet — não há undo na app.')) return;
      btn.disabled = true;
      btn.textContent = 'A apagar…';
      enviarEscrita_('apagarBoletim', { idBoletim: b.id })
        .then(function () { window.BetTrackerApp.refresh(); })
        .catch(function (err) {
          btn.disabled = false;
          btn.textContent = '🗑️ Apagar boletim';
          alert('Não foi possível apagar: ' + err.message);
        });
    });

    return det;
  }

  /** Delegado no <body> — cobre o botão "Marcar pago" tanto nas pernas do
   * histórico como na tabela de Faltas de Prognóstico (ambas recriam o seu
   * innerHTML a cada render, por isso um listener por botão seria perdido). */
  document.body.addEventListener('click', function (ev) {
    var btn = ev.target.closest && ev.target.closest('.btn-marcar-pago');
    if (!btn) return;
    ev.preventDefault();
    btn.disabled = true;
    var textoOriginal = btn.textContent;
    btn.textContent = 'A gravar…';
    enviarEscrita_('marcarPago', { sheet: btn.dataset.sheet, linha: Number(btn.dataset.linha) })
      .then(function () { window.BetTrackerApp.refresh(); })
      .catch(function (err) {
        btn.disabled = false;
        btn.textContent = textoOriginal;
        alert('Não foi possível marcar como pago: ' + err.message);
      });
  });

  function renderHistorico(historico, epoca) {
    var lista = document.getElementById('historico-lista');
    var resumo = document.getElementById('historico-resumo');
    var filtrados = (!epoca || epoca === 'Todas')
      ? historico
      : historico.filter(function (b) { return b.epoca === epoca; });

    var nPendentes = filtrados.filter(function (b) { return !b.concluido; }).length;
    resumo.innerHTML = '<span>' + filtrados.length + ' boletim(ns)'
      + (epoca && epoca !== 'Todas' ? ' na época ' + esc(epoca) : '') + '</span>'
      + (nPendentes ? '<span class="badge-pendente">⏳ ' + nPendentes + ' por fechar</span>' : '');

    lista.innerHTML = '';
    if (filtrados.length === 0) {
      lista.innerHTML = '<div class="estado-msg">Sem boletins para esta época.</div>';
      return;
    }
    var frag = document.createDocumentFragment();
    filtrados.forEach(function (b) { frag.appendChild(cartaoBoletim(b)); });
    lista.appendChild(frag);
  }

  // --- Navegação e arranque ---

  epocaSelect.addEventListener('change', function () { renderEpoca(epocaSelect.value); });

  var VISTAS = ['dashboard', 'historico', 'registar', 'config'];
  function trocarTab(nome) {
    VISTAS.forEach(function (v) {
      document.getElementById('vista-' + v).hidden = v !== nome;
      document.getElementById('tab-' + v).classList.toggle('active', v === nome);
    });
  }
  VISTAS.forEach(function (v) {
    document.getElementById('tab-' + v).addEventListener('click', function () { trocarTab(v); });
  });

  carregarTudo();

  // Exposto para js/registar.js: config partilhada (sem 2º pedido) e refresh
  // depois de um registo com sucesso.
  window.BetTrackerApp = {
    configPronta: configPronta,
    refresh: refresh,
    aoAtualizarConfig: aoAtualizarConfig,
  };
})();
