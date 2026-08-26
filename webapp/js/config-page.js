(function () {
  'use strict';

  var API_URL = window.BET_TRACKER_API_URL;

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function hoje() {
    return new Date().toISOString().slice(0, 10);
  }

  function fmtData(iso) {
    if (!iso) return '—';
    var p = String(iso).slice(0, 10).split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso;
  }

  function fmtEuro(v) {
    return Number(v).toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' });
  }

  function fmtNum(v) {
    return Number(v).toLocaleString('pt-PT', { maximumFractionDigits: 2 });
  }

  /** POST genérico — mesmo padrão de js/app.js e js/registar.js (Content-Type
   * text/plain evita o preflight CORS que o Apps Script não sabe responder). */
  function enviar(action, dados) {
    return fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action: action }, dados)),
    }).then(function (r) { return r.json(); }).then(function (resp) {
      if (resp.erro) throw new Error(resp.erro);
      return resp;
    });
  }

  function mostrarMsg(card, tipo, texto) {
    var el = card.querySelector('.form-msg');
    if (!el) return;
    el.textContent = texto;
    el.className = 'form-msg ' + tipo;
  }
  function limparMsg(card) {
    mostrarMsg(card, '', '');
  }

  // --- Listas simples: Jogadores / Desportos / Tipos de Jornada ---

  function renderLista(idCard, itens) {
    var ul = document.getElementById(idCard).querySelector('.config-lista');
    ul.innerHTML = '';
    itens.forEach(function (i) {
      var li = document.createElement('li');
      li.textContent = i;
      ul.appendChild(li);
    });
  }

  function wireFormSimples(idCard) {
    var card = document.getElementById(idCard);
    var form = card.querySelector('.config-form-simples');
    var action = form.dataset.action;
    var campo = form.dataset.campo;
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      limparMsg(card);
      var input = form.querySelector('input');
      var valor = input.value.trim();
      if (!valor) return;
      var btn = form.querySelector('button');
      btn.disabled = true;
      var body = {};
      body[campo] = valor;
      enviar(action, body).then(function () {
        input.value = '';
        mostrarMsg(card, 'ok', '✅ Adicionado.');
        window.BetTrackerApp.refresh();
      }).catch(function (err) {
        mostrarMsg(card, 'erro', '❌ ' + err.message);
      }).finally(function () { btn.disabled = false; });
    });
  }

  // --- Valores numéricos versionados por data: Stake / Odd Mínima ---

  function renderValorVersionado(idCard, historico, valorAtual, fmt) {
    var card = document.getElementById(idCard);
    card.querySelector('.config-valor-atual').innerHTML = '<strong>Valor atual: ' + fmt(valorAtual) + '</strong>';
    var tbody = card.querySelector('.config-historico-tabela tbody');
    tbody.innerHTML = '';
    if (!historico || historico.length <= 1) {
      var tr0 = document.createElement('tr');
      tr0.innerHTML = '<td class="config-sem-historico" colspan="2">Sem alterações registadas — sempre foi ' + fmt(valorAtual) + '.</td>';
      tbody.appendChild(tr0);
      return;
    }
    historico.slice().reverse().forEach(function (v) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + fmt(v.valor) + '</td><td>' + (v.vigenteDesde ? 'desde ' + fmtData(v.vigenteDesde) : 'valor original') + '</td>';
      tbody.appendChild(tr);
    });
  }

  function wireFormValor(idCard) {
    var card = document.getElementById(idCard);
    var form = card.querySelector('.config-form-valor');
    var campo = form.dataset.campo;
    form.querySelector('input[type="date"]').value = hoje();
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      limparMsg(card);
      var valor = Number(form.querySelector('input[type="number"]').value);
      var vigenteDesde = form.querySelector('input[type="date"]').value;
      var btn = form.querySelector('button');
      btn.disabled = true;
      enviar('definirValorVersionado', { campo: campo, valor: valor, vigenteDesde: vigenteDesde }).then(function () {
        mostrarMsg(card, 'ok', '✅ Definido — só afeta boletins a partir de ' + fmtData(vigenteDesde) + '.');
        form.reset();
        form.querySelector('input[type="date"]').value = hoje();
        window.BetTrackerApp.refresh();
      }).catch(function (err) {
        mostrarMsg(card, 'erro', '❌ ' + err.message);
      }).finally(function () { btn.disabled = false; });
    });
  }

  // --- Tabelas de multas: Erros / Atrasos / Faltas ---

  var CAMPO_CONFIG_TABELA_ = { erros: 'multaErros', atrasos: 'multaAtrasos', faltas: 'multaFaltas' };
  var DEFINICOES_TABELAS_ = {
    erros: {
      idCard: 'config-multa-erros',
      colunasVista: ['nErrantes', 'multaIndividual', 'multaTotalBoletim', 'estadoLabel'],
      colunasForm: [
        { chave: 'nErrantes', label: 'Nº Errantes', tipo: 'number', step: '1', min: '0' },
        { chave: 'multaIndividual', label: 'Multa Individual (€)', tipo: 'number', step: '0.01', min: '0' },
        { chave: 'multaTotalBoletim', label: 'Multa Total Boletim (€)', tipo: 'number', step: '0.01', min: '0' },
        { chave: 'estadoLabel', label: 'Estado (texto)', tipo: 'text' },
      ],
    },
    atrasos: {
      idCard: 'config-multa-atrasos',
      colunasVista: ['n', 'multa'],
      colunasForm: [
        { chave: 'n', label: 'Nº Atrasos no Mês', tipo: 'number', step: '1', min: '1' },
        { chave: 'multa', label: 'Multa (€)', tipo: 'number', step: '0.01', min: '0' },
      ],
    },
    faltas: {
      idCard: 'config-multa-faltas',
      colunasVista: ['n', 'multa'],
      colunasForm: [
        { chave: 'n', label: 'Nº Faltas no Mês', tipo: 'number', step: '1', min: '1' },
        { chave: 'multa', label: 'Multa (€)', tipo: 'number', step: '0.01', min: '0' },
      ],
    },
  };

  function renderTabelaAtual(tipo, linhas) {
    var def = DEFINICOES_TABELAS_[tipo];
    var tbody = document.getElementById(def.idCard).querySelector('.config-tabela-atual tbody');
    tbody.innerHTML = '';
    linhas.forEach(function (l) {
      var tr = document.createElement('tr');
      tr.innerHTML = def.colunasVista.map(function (c) { return '<td>' + esc(l[c]) + '</td>'; }).join('');
      tbody.appendChild(tr);
    });
  }

  function montarLinhaFormTabela_(def, valoresIniciais) {
    var div = document.createElement('div');
    div.className = 'config-tabela-form-linha';
    div.innerHTML = def.colunasForm.map(function (c) {
      var v = valoresIniciais && valoresIniciais[c.chave] !== undefined ? valoresIniciais[c.chave] : '';
      if (c.tipo === 'text') {
        return '<label>' + c.label + '<input type="text" data-campo="' + c.chave + '" value="' + esc(v) + '"></label>';
      }
      return '<label>' + c.label + '<input type="number" step="' + c.step + '" min="' + c.min + '" data-campo="' + c.chave + '" value="' + esc(v) + '" required></label>';
    }).join('') + '<button type="button" class="btn-remover-linha-tabela" title="Remover linha">🗑️</button>';
    div.querySelector('.btn-remover-linha-tabela').addEventListener('click', function () { div.remove(); });
    return div;
  }

  function abrirFormTabela_(tipo, tabelaAtual) {
    var def = DEFINICOES_TABELAS_[tipo];
    var card = document.getElementById(def.idCard);
    var wrap = card.querySelector('.config-form-tabela-wrap');
    wrap.hidden = false;
    wrap.innerHTML =
      '<form class="config-form-tabela">'
      + '<div class="config-tabela-form-linhas"></div>'
      + '<button type="button" class="btn-add-linha-tabela">+ linha</button>'
      + '<label class="config-vigente-desde-label">Em vigor a partir de <input type="date" class="config-tabela-vigente-desde" required></label>'
      + '<div class="edicao-botoes">'
      + '<button type="submit">💾 Guardar nova tabela</button>'
      + '<button type="button" class="btn-cancelar-tabela">Cancelar</button>'
      + '</div>'
      + '<div class="form-msg"></div>'
      + '</form>';

    var form = wrap.querySelector('form');
    var linhasWrap = form.querySelector('.config-tabela-form-linhas');
    tabelaAtual.forEach(function (l) { linhasWrap.appendChild(montarLinhaFormTabela_(def, l)); });
    form.querySelector('.config-tabela-vigente-desde').value = hoje();

    form.querySelector('.btn-add-linha-tabela').addEventListener('click', function () {
      linhasWrap.appendChild(montarLinhaFormTabela_(def, null));
    });
    form.querySelector('.btn-cancelar-tabela').addEventListener('click', function () {
      wrap.hidden = true;
      wrap.innerHTML = '';
    });

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var linhas = Array.prototype.map.call(linhasWrap.querySelectorAll('.config-tabela-form-linha'), function (linhaEl) {
        var obj = {};
        def.colunasForm.forEach(function (c) {
          var input = linhaEl.querySelector('[data-campo="' + c.chave + '"]');
          obj[c.chave] = c.tipo === 'text' ? input.value : Number(input.value);
        });
        return obj;
      });
      var vigenteDesde = form.querySelector('.config-tabela-vigente-desde').value;
      var btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      enviar('definirTabelaMultas', { tabela: tipo, vigenteDesde: vigenteDesde, linhas: linhas })
        .then(function () {
          wrap.hidden = true;
          wrap.innerHTML = '';
          window.BetTrackerApp.refresh();
        })
        .catch(function (err) {
          var msgEl = form.querySelector('.form-msg');
          msgEl.textContent = '❌ ' + err.message;
          msgEl.className = 'form-msg erro';
          btn.disabled = false;
        });
    });
  }

  var configAtual = null;

  function wireBotaoTabelaUmaVez_(tipo) {
    var def = DEFINICOES_TABELAS_[tipo];
    var card = document.getElementById(def.idCard);
    card.querySelector('.btn-definir-tabela').addEventListener('click', function () {
      abrirFormTabela_(tipo, configAtual[CAMPO_CONFIG_TABELA_[tipo]]);
    });
  }

  // --- Arranque ---

  function renderTudo(config) {
    configAtual = config;
    document.getElementById('estado-config').hidden = true;
    document.getElementById('secao-config').hidden = false;

    renderLista('config-jogadores', config.jogadores);
    renderLista('config-desportos', config.desportos);
    renderLista('config-tipos-jornada', config.tiposJornada);

    renderValorVersionado('config-stake', config.historicoConfig.montanteCombinacao, config.geral.montanteCombinacao, fmtEuro);
    renderValorVersionado('config-odd-minima', config.historicoConfig.oddMinima, config.geral.oddMinima, fmtNum);

    renderTabelaAtual('erros', config.multaErros);
    renderTabelaAtual('atrasos', config.multaAtrasos);
    renderTabelaAtual('faltas', config.multaFaltas);
  }

  wireFormSimples('config-jogadores');
  wireFormSimples('config-desportos');
  wireFormSimples('config-tipos-jornada');
  wireFormValor('config-stake');
  wireFormValor('config-odd-minima');
  wireBotaoTabelaUmaVez_('erros');
  wireBotaoTabelaUmaVez_('atrasos');
  wireBotaoTabelaUmaVez_('faltas');

  // aoAtualizarConfig dispara em TODOS os carregamentos (1º incluído) — ao
  // contrário de configPronta (só resolve 1 vez), por isso é isto que mantém a
  // página sincronizada depois de qualquer alteração feita aqui.
  window.BetTrackerApp.aoAtualizarConfig(renderTudo);
  window.BetTrackerApp.configPronta.catch(function (err) {
    var el = document.getElementById('estado-config');
    el.hidden = false;
    el.classList.add('erro');
    el.textContent = 'Não foi possível carregar as configurações: ' + err.message;
  });
})();
