# Bet Tracker — Schema Google Sheets + Arquitetura API (Fase 1)

> Ver [PLANO_BET_TRACKER_WEBAPP.md](../PLANO_BET_TRACKER_WEBAPP.md) para o contexto e decisões já tomadas.
> Este documento cobre os pontos 1 e 2 da Fase 1 do roteiro: schema de dados + arquitetura da API,
> a partir da inspeção direta de `bet_tracker_calude.xlsx` com `openpyxl`.

## Princípio de arquitetura (decisão central desta fase)

O `.xlsx` atual mistura, na mesma linha/coluna, **dados em bruto** (o que um utilizador escreveu)
com **dados calculados** (fórmulas). Em particular, o separador `PERFORMANCE` tem ~90 colunas
auxiliares (`BA:CM`) que implementam uma verdadeira *state machine sequencial*: cada linha lê o
valor da linha anterior para acumular banca e sequências de vitórias/derrotas por jogador, boletim
a boletim, por ordem cronológica.

Replicar isto com fórmulas do Google Sheets seria frágil (750+ linhas de apostas, fórmulas que
dependem de todas as linhas anteriores) e dececionaria a Fase 3 (escrita), porque cada nova aposta
obrigaria a copiar fórmulas para mais uma linha.

**Decisão:** a Google Sheet guarda **apenas dados em bruto** (o que teria de ser escrito à mão).
Todos os valores derivados — desde "Odd Total" de um boletim até à "Sequência Atual" de um jogador —
são calculados no **Apps Script**, a pedido, e devolvidos já prontos em JSON ao frontend. A Sheet
deixa de ter fórmulas de negócio; passa a ser só a base de dados. Isto cumpre a decisão nº4 do plano
(schema pensado para extensão) porque uma nova aposta ou multa é só uma linha nova — o cálculo
recalcula tudo a partir dela sem precisar de "arrastar fórmulas".

Os separadores/tabelas do Google Sheets espelham a estrutura atual do Excel (para os utilizadores
que continuem a editar a Sheet diretamente como *fallback*, tal como o Excel), mas sem as colunas
calculadas.

---

## 1. Estrutura da Google Sheet

### `Apostas` (equivale a APOSTAS, colunas A-J, U, V do Excel)

Uma linha por **perna** de boletim. Um boletim = N linhas consecutivas com o mesmo `id_boletim`
(N = `numero_jogadores` em Config, hoje 5 — um jogador por perna).

| Coluna         | Tipo                          | Notas |
|----------------|-------------------------------|-------|
| id_boletim     | texto (`B001`, `B002`, ...)   | repete nas N linhas do mesmo boletim |
| data           | data                          | |
| tipo_jornada   | texto (lista `Config_TiposJornada`) | |
| jogador        | texto (lista `Config_Jogadores`) | |
| desporto       | texto (lista `Config_Desportos`) | |
| partida        | texto livre                   | |
| prognostico    | texto livre                   | ex: "V1", "X2" |
| odd            | número                        | |
| atraso         | "Sim" / "Não"                 | pick enviado fora de horas |
| resultado      | "Acertou" / "Errou" / "Pendente" / "Devolvido" | |
| observacoes    | texto livre                   | |
| pago           | texto: vazio / "Por Pagar" / "Sem Multa" / "Pago" | **campo híbrido** — ver nota abaixo |

**Nota sobre `pago`:** no Excel original a coluna V tem uma fórmula que sugere o estado
(`Pendente` / `Por Pagar` / `Sem Multa`), mas em várias linhas o utilizador substitui manualmente
o valor por `"Pago"` assim que a multa é liquidada — a fórmula é substituída por texto fixo. A app
replica isto tratando **qualquer valor diferente de `"Pago"` como pendente** (não só `"Por Pagar"`
explícito) — um boletim registado pela app fica sempre com `pago` em branco até alguém marcar,
e ainda assim entra logo nos "Pendentes"/`multasPendentes`, sem precisar de nenhum passo extra. Na
página **Histórico**, cada perna com multa (erro/atraso) tem um botão "💶 Marcar pago" que chama
`?action=marcarPago` e escreve `"Pago"` diretamente nesta coluna.

Todas as restantes colunas do Excel original (`K` a `T`, `W`: Odd Total, Ganhos Possíveis, Erros,
Estado, Ganho Real, Multas Boletim, Lucro, Multa Atraso, Multa Erro, Multa Total, Época) **não são
guardadas** — são sempre calculadas pelo Apps Script (ver secção 3).

### `MultaFaltas` (equivale ao separador "MULTA PROGNÓSTICO" do Excel, antes chamado "MULTA FALTAS")

| Coluna   | Tipo   | Notas |
|----------|--------|-------|
| data     | data   | |
| jogador  | texto  | |
| motivo   | texto livre (opcional) | |
| estado   | "Por Pagar" / "Pago" | igual à `pago` de Apostas — editável; qualquer valor diferente de "Pago" conta como pendente |

`Nº Falta no Mês` e `Multa (€)` deixam de ser guardados — calculados pelo Apps Script.

### `Levantamentos` (igual ao Excel, já só tinha dados em bruto)

| Coluna       | Tipo   |
|--------------|--------|
| data         | data   |
| motivo       | texto  |
| valor        | número |
| observacoes  | texto  |

### `Config` (separadores mais pequenos, um por tabela, substituindo o layout livre de CONFIGURAÇÕES)

- **Config_Geral** (chave/valor): `banca_inicial`, `montante_por_combinacao`, `lucro_minimo`,
  `numero_jogadores`, `odd_minima`, `mes_inicio_epoca` (=7, julho — hoje fixo no Excel, torna-se
  configurável).
  `custo_boletim` não se guarda — é sempre `montante_por_combinacao * numero_jogadores`.
- **Config_Jogadores**: lista simples de jogadores (Diogo, Filipe, João, Rafael, Samuel).
- **Config_TiposJornada**: lista (Competições Internas / Europeias / Internacionais).
- **Config_Desportos**: lista (Futebol, Futsal, Basketball, Ténis, MMA, Outro).
- ~~**Config_Epocas**~~: obsoleta. As épocas passaram a ser **calculadas a partir das datas** dos
  dados (ver secção 3). A aba pode continuar na Sheet, mas é ignorada pelo código.
- **Config_MultaErros**: `nº_errantes` (0 a `numero_jogadores`) → `multa_individual`,
  `multa_total_boletim`, `estado_label`.
- **Config_MultaAtrasos**: `nº_atrasos_no_mes` → `multa` (reset mensal por jogador).
- **Config_MultaFaltas**: `nº_faltas_no_mes` → `multa` (reset mensal por jogador).

**Config versionada por data (`vigente_desde`)**: `Config_Geral` (só para as chaves
`montante_por_combinacao` e `odd_minima`) e as 3 tabelas de multas acima têm uma coluna extra
opcional `vigente_desde` (data). Uma linha sem essa data é o valor "base" (sempre em vigor até
haver uma versão mais recente); uma linha nova com uma data é uma alteração que só passa a valer
para boletins/faltas **a partir dessa data** — os já registados continuam a usar o valor que
estava em vigor quando foram registados. Nunca se edita/apaga uma linha antiga: para mudar o
stake ou uma tabela de multas, acrescenta-se uma linha (ou, no caso das tabelas, o conjunto
completo de linhas) nova com a data de vigência. Ver secção 3 (`configParaData_`) e a página
"Configurações" da app, que faz isto pelos endpoints de escrita em vez de editar a Sheet à mão.

---

## 2. Lógica de negócio a replicar no Apps Script (não na Sheet)

Confirmada por inspeção direta das fórmulas do `.xlsx` (não assumida):

**Por boletim** (grupo de N linhas em `Apostas` com o mesmo `id_boletim`, N = `numero_jogadores`):
- **Odd Total** = soma, para cada perna, do produto das odds das *outras* N-1 pernas (fórmula tipo
  "sistema" — no Excel está hard-coded para N=5; no Apps Script generaliza-se para N configurável:
  soma de todos os subconjuntos de tamanho N-1).
- **Ganhos Possíveis** = Odd Total × `montante_por_combinacao`.
- **Nº Erros** = contagem de pernas "Errou" com odd ≠ 1 e odd preenchida (só depois de todas as N
  pernas terem resultado, i.e. nenhuma "Pendente"; senão o boletim fica "-").
- **Estado**: 0 erros → "Vencedor (N/N)"; 1 erro → "Vencedor (N-1/N)"; 2+ erros → "Perdedor (.../N)".
- **Ganho Real**: 0 erros → Ganhos Possíveis; 1 erro → (produto das odds vencedoras ÷ odd da perna
  errada) × `montante_por_combinacao`; 2+ erros → `-custo_boletim`.
- **Multas Boletim** = soma da Multa Total (ver abaixo) das N pernas.
- **Lucro** = `ganho_real - (custo_boletim se venceu 5/5 ou 4/5, senão 0) + multas_boletim`.

**Por perna (linha):**
- **Multa Atraso**: contagem progressiva de "Sim" em atraso, por jogador, dentro do mês/ano da
  data — lookup em `Config_MultaAtrasos` pelo nº de atrasos desse mês até essa linha (reset
  automático a cada mês, tal como no Excel).
- **Multa Erro**: só se a perna "Errou" (e odd ≠ 1, e boletim já concluído) — lookup em
  `Config_MultaErros` pelo nº de erros *do boletim*; duplica se `odd < odd_minima`.
- **Multa Total** = Multa Atraso + Multa Erro.
- **Época**: derivada da data (época começa no mês `mes_inicio_epoca`, hoje julho) — nunca
  guardada, sempre calculada.

**`MultaFaltas`**: `Nº Falta no Mês` = contagem progressiva por jogador dentro do mês/ano; `Multa`
= lookup em `Config_MultaFaltas` por `min(nº_falta_no_mes, 4)`.

**Todos os lookups acima usam a versão da tabela/valor em vigor NA DATA do boletim/falta em
questão** (`configParaData_`), não a versão atual — é assim que uma alteração de stake ou de
multas feita hoje só afeta o que for registado a partir de agora.

**Dashboard `PERFORMANCE`** (tudo calculado a pedido, filtrado por `epoca` — exceto os dois KPIs
marcados "Global" abaixo, tal como no Excel original):
- **Banca Atual (Global)**: sempre sem filtro de época = `banca_inicial + Σ lucro(boletins
  concluídos) + Σ multas_faltas - Σ levantamentos`.
- **Total Levantado (Global)**: soma de todos os levantamentos, sem filtro de época.
- **Restantes KPIs, filtrados por época**: Lucro Total, Boletins Concluídos, Taxa de Sucesso, Odd
  Média, Multas Totais/Pendentes, Multas Falta Prognóstico, Nº Faltas Registadas.
- **Evolução da Banca**: percorre os boletins concluídos por ordem cronológica (globalmente,
  intercalando eventos de multas/levantamentos por data) acumulando a banca; os pontos do gráfico
  são depois filtrados para a época selecionada (tal como no Excel, a série é sempre a banca
  global mas só se mostram os pontos da época escolhida).
- **Sequências (Seq. Atual / Máx. Vitórias / Máx. Derrotas) por jogador**: acumuladas boletim a
  boletim, dentro dos boletins já filtrados pela época.
- **Performance Individual**: total apostas/acertos, taxa, odd mediana (todas/acerto/erro), maior
  odd acertada, sequências — por jogador, filtrado por época.
- **Classificação**: 7 categorias (Maior Taxa de Acerto, Maior Odd Acertada, Maior Sequência de
  Vitórias, Maior Sequência de Derrotas, Maior Assiduidade, Pior Assiduidade, Maior Contribuição em
  Multas) — derivadas dos rollups acima, filtrado por época.
- **Multas por Jogador** / **Multas por Tipo** (Atraso / Erro Prognóstico / Falta de Prognóstico,
  para o gráfico de pizza), filtrado por época.
- **Performance por Desporto** (global e matriz jogador × desporto), filtrado por época.
- **Correlação de Acertos entre Jogadores**: matriz N×N sobre a flag acerto/erro por boletim,
  filtrado por época.

Todos os rollups por jogador acima são recalculados por época dentro de `rollupsPorJogador_`
(`Calculo.gs`), chamada uma vez por época (incluindo "Todas") a partir de `fatiaEpoca_` — não é
uma passagem cara: o trabalho pesado (`calcularResultadoBoletim_`/`calcularMultasPorPerna_`) já foi
feito uma única vez, sobre todos os boletins, em `computarBase_`.

Toda esta lógica cabe numa única função `computarDashboard(epoca)` em Apps Script que percorre os
boletins uma vez (agrupando `Apostas` por `id_boletim`, ordenando por data) e vai acumulando estado
por jogador — o equivalente direto, em código, ao que as colunas `BA:CM` fazem em fórmulas.

---

## 3. Arquitetura da API (Apps Script Web App)

Um único projeto Apps Script ligado à Sheet, publicado como Web App (`doGet`/`doPost`).
**Nenhum deployment "Anyone" é feito sem confirmação explícita** (ver restrições no plano).

### Endpoints de leitura

- `GET ?action=dashboard` → **payload completo, num só pedido**:
  - `epocasDisponiveis` — derivadas das datas reais dos dados (ver abaixo);
  - `porEpoca` — mapa `{ "Todas": {kpis, evolucaoBanca, classificacao, performanceIndividual,
    multasPorJogador, multasPorTipo, performanceDesporto, performanceDesportoIndividual,
    correlacao, faltas}, "25/26": {...}, ... }` com a fatia de **todas** as épocas já calculada. Só
    `kpis.bancaAtual` e `kpis.totalLevantado` ficam sempre globais (tal como no Excel original) —
    tudo o resto dentro de cada fatia está filtrado para essa época. `faltas` é a lista crua das
    faltas de prognóstico (não só a soma), cada uma com `linha` — para o botão "Marcar pago" no
    frontend chamar `?action=marcarPago` com essa referência;
  - `historico` — todos os boletins **com dados** (incluindo os **pendentes**, que não entram em
    cálculo nenhum), do mais recente para o mais antigo, cada um com a sua `epoca` e as suas pernas.
    Ignora as linhas placeholder sem data e sem pernas preenchidas que vieram da migração do Excel
    (resíduos das jornadas futuras pré-alocadas que o Excel guardava vazias);
  - `config` — para o frontend popular os formulários sem um 2º pedido.
- `GET ?action=config` → só a config (mantido para diagnóstico e como fallback do frontend).

> **Porque não há `&epoca=`**: trocar de época obrigava a recarregar as 11 abas e a recalcular tudo
> do zero a cada troca — era a causa do atraso sentido. Agora o cálculo caro (agrupar boletins,
> resultados, multas por perna) é feito numa passagem só sobre TODOS os dados (`computarBase_`); os
> rollups por jogador que dependem da época (`rollupsPorJogador_`) e os KPIs são recalculados por
> cima disso uma vez por época dentro de `fatiaEpoca_` — barato, porque só filtra/soma o que já foi
> calculado. O frontend troca de época em memória, sem rede.

> **Épocas**: `Config_Epocas` deixou de ser lida. `epocasDosDados_` deriva-as das datas de
> `Apostas`/`MultaFaltas`/`Levantamentos` via `calcularEpoca_` + `mes_inicio_epoca`, ordenadas da
> mais recente para a mais antiga. Uma data numa época ainda não vista cria a época sozinha.

### Endpoints de escrita (desenhados agora, implementados na Fase 3)

- `POST ?action=registarAposta` — body com as N pernas de um novo boletim; gera `id_boletim`
  seguinte automaticamente; valida (odds preenchidas, jogadores válidos) antes de gravar.
- `POST ?action=atualizarBoletim` — edita um boletim existente (data, tipo de jornada, e por perna:
  desporto/partida/prognóstico/odd/atraso/**resultado**). É assim que um boletim passa de "Pendente"
  a concluído (ou se corrige um erro de digitação já concluído) — não há um endpoint separado só
  para "marcar resultado". `pago` nunca é tocado aqui (fica preservado do valor existente); só
  `marcarPago_` o muda. Atualiza as linhas existentes em `Apostas` (por `id_boletim` + `jogador`),
  nunca apaga/duplica.
- `POST ?action=registarFalta` — body com data/jogador/motivo.
- `POST ?action=registarLevantamento` — body com data/motivo/valor/observações.
- `POST ?action=marcarPago` — body com referência (`sheet: "Apostas"|"MultaFaltas"`, `linha`) →
  escreve `"Pago"` no campo `pago`/`estado`. No frontend: botão "💶 Marcar pago" em cada perna com
  multa no Histórico, e em cada falta na tabela "Faltas de Prognóstico registadas" (secção Multas).
- `POST ?action=adicionarJogador` / `adicionarDesporto` / `adicionarTipoJornada` — acrescenta um
  valor às respetivas listas (`Config_Jogadores`/`Config_Desportos`/`Config_TiposJornada`); rejeita
  duplicados. Não há remoção (quebraria estatísticas de boletins já registados).
- `POST ?action=definirValorVersionado` — body `{campo: "montante_por_combinacao"|"odd_minima",
  valor, vigenteDesde}` → acrescenta uma linha nova a `Config_Geral` com essa data de vigência.
- `POST ?action=definirTabelaMultas` — body `{tabela: "erros"|"atrasos"|"faltas", vigenteDesde,
  linhas: [...]}` → acrescenta a tabela completa nova (todas as linhas com o mesmo `vigenteDesde`)
  à respetiva aba de multas.

Os endpoints de escrita devolvem `{ok: true}` (e `idBoletim` no caso de `registarAposta`); o
frontend chama depois `?action=dashboard` para refrescar. Todo o `doPost` corre dentro de um
`LockService.getScriptLock()`, para dois registos simultâneos não colidirem no `id_boletim`.

### Porque este desenho aguenta a Fase 3 sem reescrever nada

- A Sheet só tem dados em bruto → um `POST` é sempre "acrescentar uma linha", nunca "recalcular
  fórmulas a jusante".
- O cálculo vive todo num módulo Apps Script (`Calculo.gs`), chamado tanto pelos endpoints de
  leitura como, no futuro, pelos de escrita antes de devolver a resposta — zero duplicação de
  lógica entre ler e escrever.
- Os identificadores de boletim (`B001`, `B002`, ...) são gerados a partir do máximo atual + 1,
  não de fórmulas de linha — funciona igual com 1 ou 10000 boletins.

---

## 4. Mapeamento para a migração (Fase 1, ponto 2)

O script `migration/migrate_to_sheets.py` lê `bet_tracker_calude.xlsx` com `openpyxl` (só os
valores, `data_only=True`) e escreve, para cada boletim/linha, **apenas as colunas em bruto**
listadas na secção 1 — as colunas calculadas (K-T, W em APOSTAS; D-F em MULTA FALTAS) são
recalculadas no primeiro carregamento do dashboard, não copiadas do Excel. Isto serve também como
validação cruzada: se o valor que o Apps Script calcula no dia 1 não bater certo com o que estava
no Excel, é sinal de uma diferença na lógica replicada.
