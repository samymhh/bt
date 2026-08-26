/**
 * Backup automático da Google Sheet, para o caso de corrupção de dados,
 * apagar algo por engano, etc.
 *
 * Cria uma cópia completa da spreadsheet (via Drive) todos os dias, dentro de
 * uma subpasta "Backups Bet Tracker" na MESMA pasta do Drive onde já está a
 * Sheet original — ou seja, a mesma pasta partilhada com o grupo. Mantém só
 * os últimos MANTER_BACKUPS_ cópias; as mais antigas são apagadas (vão para
 * o lixo do Drive, recuperáveis durante 30 dias, não é apagar definitivo).
 *
 * Setup (uma única vez): no editor do Apps Script, seleciona a função
 * `configurarBackupDiario_` no menu de funções e clica em "Executar". Vai
 * pedir autorização extra (acesso ao Drive) — é normal, aceita. Isto cria o
 * trigger diário e corre logo um backup de teste.
 */

var MANTER_BACKUPS_ = 14;
var NOME_PASTA_BACKUPS_ = 'Backups Bet Tracker';

function criarBackupSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ficheiro = DriveApp.getFileById(ss.getId());
  var pastas = ficheiro.getParents();
  var pastaBase = pastas.hasNext() ? pastas.next() : DriveApp.getRootFolder();
  var pastaBackups = obterOuCriarSubpasta_(pastaBase, NOME_PASTA_BACKUPS_);

  var nome = 'Backup Bet Tracker - ' + Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd HHmm');
  ficheiro.makeCopy(nome, pastaBackups);

  limparBackupsAntigos_(pastaBackups, MANTER_BACKUPS_);
}

function obterOuCriarSubpasta_(pastaBase, nome) {
  var it = pastaBase.getFoldersByName(nome);
  if (it.hasNext()) return it.next();
  return pastaBase.createFolder(nome);
}

/** Mantém só os `manter` ficheiros mais recentes da pasta; move o resto para o lixo. */
function limparBackupsAntigos_(pasta, manter) {
  var ficheiros = [];
  var it = pasta.getFiles();
  while (it.hasNext()) ficheiros.push(it.next());
  ficheiros.sort(function (a, b) { return b.getDateCreated().getTime() - a.getDateCreated().getTime(); });
  ficheiros.slice(manter).forEach(function (f) { f.setTrashed(true); });
}

/** Corre isto UMA VEZ manualmente (ver instruções no topo do ficheiro). */
function configurarBackupDiario_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'criarBackupSheet_') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('criarBackupSheet_').timeBased().everyDays(1).atHour(3).create();
  criarBackupSheet_();
}
