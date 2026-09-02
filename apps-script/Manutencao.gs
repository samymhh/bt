/**
 * Utilitário de manutenção PONTUAL — não faz parte do funcionamento normal da
 * app, nem é chamado por nenhum endpoint. Corre-se UMA VEZ manualmente no
 * editor do Apps Script para saldar o histórico antigo, na sequência da
 * correção de `Calculo.gs` que passou a tratar `pago`/`estado` em branco como
 * "por pagar" em vez de ignorar (ver docs/SCHEMA.md, secção Apostas).
 *
 * O que faz, para tudo o que for ANTES de `DATA_CORTE_SALDO_`:
 *   - Apostas: pernas com multa (erro ou atraso) → `pago = "Pago"`.
 *              pernas sem multa nenhuma          → `pago = "Sem Multa"`.
 *   - MultaFaltas: `estado = "Pago"`.
 * Pendentes (`resultado = "Pendente"`) nunca são tocados. Nada a partir de
 * `DATA_CORTE_SALDO_` (inclusive) é tocado — fica como está, para continuares
 * a marcar "Pago" pela app à medida que forem sendo liquidados de verdade.
 *
 * Setup: muda `DATA_CORTE_SALDO_` abaixo se não for 25/08/2026, grava (Ctrl+S),
 * seleciona `saldarHistoricoAntigo_` no menu de funções e clica em "Executar".
 * Vê quantas linhas mudaram em Ver → Registos (Logger.log). Idempotente —
 * podes correr mais que uma vez sem problema, e podes apagar este ficheiro
 * depois de correr (não é preciso manter para a app funcionar).
 */

var DATA_CORTE_SALDO_ = '2026-08-25';

function saldarHistoricoAntigo_() {
  var corte = paraData_(DATA_CORTE_SALDO_);
  if (!corte) throw new Error('DATA_CORTE_SALDO_ inválida: ' + DATA_CORTE_SALDO_);
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var sheetApostas = ss.getSheetByName('Apostas');
  var valoresApostas = sheetApostas.getDataRange().getValues();
  var cabApostas = valoresApostas[0];
  var colData = cabApostas.indexOf('data');
  var colResultado = cabApostas.indexOf('resultado');
  var colOdd = cabApostas.indexOf('odd');
  var colAtraso = cabApostas.indexOf('atraso');
  var colPago = cabApostas.indexOf('pago');
  var tocadosApostas = 0;
  for (var i = 1; i < valoresApostas.length; i++) {
    var linha = valoresApostas[i];
    var data = paraData_(linha[colData]);
    if (!data || data.getTime() >= corte.getTime()) continue;
    var resultado = linha[colResultado];
    if (!resultado || resultado === 'Pendente') continue;
    var temMulta = linha[colAtraso] === 'Sim' || (resultado === 'Errou' && Number(linha[colOdd]) !== 1);
    var novoValor = temMulta ? 'Pago' : 'Sem Multa';
    if (linha[colPago] !== novoValor) {
      sheetApostas.getRange(i + 1, colPago + 1).setValue(novoValor);
      tocadosApostas++;
    }
  }

  var sheetFaltas = ss.getSheetByName('MultaFaltas');
  var valoresFaltas = sheetFaltas.getDataRange().getValues();
  var cabFaltas = valoresFaltas[0];
  var colDataF = cabFaltas.indexOf('data');
  var colEstado = cabFaltas.indexOf('estado');
  var tocadosFaltas = 0;
  for (var j = 1; j < valoresFaltas.length; j++) {
    var linhaF = valoresFaltas[j];
    var dataF = paraData_(linhaF[colDataF]);
    if (!dataF || dataF.getTime() >= corte.getTime()) continue;
    if (linhaF[colEstado] !== 'Pago') {
      sheetFaltas.getRange(j + 1, colEstado + 1).setValue('Pago');
      tocadosFaltas++;
    }
  }

  Logger.log('Apostas: ' + tocadosApostas + ' linha(s) atualizada(s). MultaFaltas: ' + tocadosFaltas
    + ' linha(s) atualizada(s). Corte: tudo antes de ' + DATA_CORTE_SALDO_ + ' (essa data e depois não foi tocada).');
}
