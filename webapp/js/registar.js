(function () {
  'use strict';

  var API_URL = window.BET_TRACKER_API_URL;
  var UTILIZADOR_KEY = 'bt_utilizador';

  var utilizadorSelect = document.getElementById('utilizador-select');
  var faltaJogadorSelect = document.getElementById('falta-jogador');
  var boletimTipoJornadaSelect = document.getElementById('boletim-tipo-jornada');
  var boletimPernasEl = document.getElementById('boletim-pernas');

  var configCarregada = null;

  function hoje() {
    return new Date().toISOString().slice(0, 10);
  }

  function preencherSelect(select, opcoes) {
    opcoes.forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o; opt.textContent = o;
      select.appendChild(opt);
    });
  }

  function utilizadorAtual() {
    return window.localStorage.getItem(UTILIZADOR_KEY) || '';
  }

  function aplicarUtilizadorAosFormularios() {
    var u = utilizadorAtual();
    if (u && faltaJogadorSelect.querySelector('option[value="' + u + '"]')) {
      faltaJogadorSelect.value = u;
    }
  }

  function montarLinhasPernas(config) {
    boletimPernasEl.innerHTML = '';
    config.jogadores.forEach(function (jogador) {
      var row = document.createElement('div');
      row.className = 'perna-row';
      row.dataset.jogador = jogador;
      row.innerHTML =
        '<div class="perna-jogador">' + jogador + '</div>' +
        '<select class="perna-desporto" required></select>' +
        '<input class="perna-partida" type="text" placeholder="Partida / evento">' +
        '<input class="perna-prognostico" type="text" placeholder="Prognóstico (ex: V1)" required>' +
        '<input class="perna-odd" type="number" step="0.01" min="1" placeholder="Odd" required>' +
        '<label class="perna-atraso-label"><input class="perna-atraso" type="checkbox"> Atrasado?</label>';
      boletimPernasEl.appendChild(row);
      preencherSelect(row.querySelector('.perna-desporto'), config.desportos);
    });
  }

  function aplicarConfig(config) {
    configCarregada = config;
    preencherSelect(utilizadorSelect, config.jogadores);
    preencherSelect(faltaJogadorSelect, config.jogadores);
    preencherSelect(boletimTipoJornadaSelect, config.tiposJornada);
    montarLinhasPernas(config);
    aplicarUtilizadorAosFormularios();
    var uGuardado = utilizadorAtual();
    if (uGuardado) utilizadorSelect.value = uGuardado;
  }

  /** A config vem no mesmo payload que o dashboard (ver js/app.js), por isso não
   * fazemos um 2º pedido no arranque. Só se esse falhar é que pedimos à parte. */
  function carregarConfigParaFormularios() {
    return window.BetTrackerApp.configPronta
      .catch(function () {
        return fetch(API_URL + '?action=config').then(function (r) { return r.json(); });
      })
      .then(aplicarConfig)
      .catch(function () {
        mostrarMsg('boletim-msg', 'erro', 'Não foi possível carregar as opções (jogadores/desportos). Recarrega a página.');
      });
  }

  function mostrarMsg(id, tipo, texto) {
    var el = document.getElementById(id);
    el.textContent = texto;
    el.className = 'form-msg ' + tipo;
  }

  function limparMsg(id) {
    var el = document.getElementById(id);
    el.textContent = '';
    el.className = 'form-msg';
  }

  function enviar(action, payload) {
    return fetch(API_URL, {
      method: 'POST',
      // Content-Type text/plain evita o preflight CORS (Apps Script não responde a OPTIONS);
      // o corpo é lido como JSON do lado do servidor independentemente do content-type.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action: action }, payload)),
    }).then(function (r) { return r.json(); }).then(function (resp) {
      if (resp.erro) throw new Error(resp.erro);
      return resp;
    });
  }

  function comBotaoDesativado(form, fn) {
    var btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    return fn().finally(function () { btn.disabled = false; });
  }

  // --- Utilizador ---
  utilizadorSelect.addEventListener('change', function () {
    window.localStorage.setItem(UTILIZADOR_KEY, utilizadorSelect.value);
    aplicarUtilizadorAosFormularios();
  });

  // --- Registar Boletim ---
  var formBoletim = document.getElementById('form-boletim');
  document.getElementById('boletim-data').value = hoje();
  formBoletim.addEventListener('submit', function (ev) {
    ev.preventDefault();
    limparMsg('boletim-msg');

    var pernas = Array.prototype.map.call(boletimPernasEl.querySelectorAll('.perna-row'), function (row) {
      return {
        jogador: row.dataset.jogador,
        desporto: row.querySelector('.perna-desporto').value,
        partida: row.querySelector('.perna-partida').value,
        prognostico: row.querySelector('.perna-prognostico').value,
        odd: Number(row.querySelector('.perna-odd').value),
        atraso: row.querySelector('.perna-atraso').checked ? 'Sim' : 'Não',
      };
    });

    comBotaoDesativado(formBoletim, function () {
      return enviar('registarAposta', {
        data: document.getElementById('boletim-data').value,
        tipoJornada: boletimTipoJornadaSelect.value,
        pernas: pernas,
      }).then(function (resp) {
        mostrarMsg('boletim-msg', 'ok', '✅ Boletim ' + resp.idBoletim + ' registado. Os resultados ainda têm de ser marcados na Sheet quando forem conhecidos.');
        formBoletim.reset();
        document.getElementById('boletim-data').value = hoje();
        montarLinhasPernas(configCarregada);
        if (window.BetTrackerApp) window.BetTrackerApp.refresh();
      }).catch(function (err) {
        mostrarMsg('boletim-msg', 'erro', '❌ ' + err.message);
      });
    });
  });

  // --- Registar Falta ---
  var formFalta = document.getElementById('form-falta');
  document.getElementById('falta-data').value = hoje();
  formFalta.addEventListener('submit', function (ev) {
    ev.preventDefault();
    limparMsg('falta-msg');
    comBotaoDesativado(formFalta, function () {
      return enviar('registarFalta', {
        data: document.getElementById('falta-data').value,
        jogador: faltaJogadorSelect.value,
        motivo: document.getElementById('falta-motivo').value,
      }).then(function () {
        mostrarMsg('falta-msg', 'ok', '✅ Falta registada.');
        document.getElementById('falta-motivo').value = '';
        if (window.BetTrackerApp) window.BetTrackerApp.refresh();
      }).catch(function (err) {
        mostrarMsg('falta-msg', 'erro', '❌ ' + err.message);
      });
    });
  });

  // --- Registar Levantamento ---
  var formLevantamento = document.getElementById('form-levantamento');
  document.getElementById('lev-data').value = hoje();
  formLevantamento.addEventListener('submit', function (ev) {
    ev.preventDefault();
    limparMsg('lev-msg');
    comBotaoDesativado(formLevantamento, function () {
      return enviar('registarLevantamento', {
        data: document.getElementById('lev-data').value,
        motivo: document.getElementById('lev-motivo').value,
        valor: Number(document.getElementById('lev-valor').value),
        observacoes: document.getElementById('lev-observacoes').value,
      }).then(function () {
        mostrarMsg('lev-msg', 'ok', '✅ Levantamento registado.');
        formLevantamento.reset();
        document.getElementById('lev-data').value = hoje();
        if (window.BetTrackerApp) window.BetTrackerApp.refresh();
      }).catch(function (err) {
        mostrarMsg('lev-msg', 'erro', '❌ ' + err.message);
      });
    });
  });

  carregarConfigParaFormularios();
})();
