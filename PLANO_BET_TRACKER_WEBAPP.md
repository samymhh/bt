# Handover — Bet Tracker: de Excel para Web App (Google Sheets + Apps Script)

## Contexto

Existe um grupo de amigos que faz apostas desportivas recreativas com banca partilhada.
Toda a gestão (apostas, multas, levantamentos, KPIs, gráficos) está atualmente num único
workbook Excel: `C:\Users\Samuel\Desktop\bet_tracker_calude.xlsx` (há também um backup
em `bet_tracker_calude_backup_20260823_121544.xlsx`).

Esse workbook foi construído ao longo de muitas sessões anteriores com o Claude Code e
já tem lógica bastante rica (ver "Estado atual a replicar" abaixo). O dono do projeto
(Samuel) quer converter isto numa página web para que todos os elementos do grupo
possam consultar E editar/adicionar dados, **sem qualquer custo** (nem hosting, nem
armazenamento, nem serviços pagos).

**Não re-derives estas decisões — já foram tomadas e validadas com o utilizador:**

## Decisões já tomadas

1. **Backend/dados: Google Sheets + Google Apps Script Web App.**
   - Razão: zero custo permanente, zero fricção de login (todos já têm conta Google),
     concorrência de escrita tratada pelo próprio Google, e a folha continua editável
     diretamente pelos utilizadores como *fallback* enquanto os formulários de escrita
     não existirem.
   - Alternativas consideradas e rejeitadas: Firebase (mais esforço de setup/auth para
     o ganho que traz aqui), Supabase (projeto free pausa por inatividade — risco para
     um grupo de uso esporádico).
2. **Frontend: HTML/CSS/JS estático** (vanilla JS é suficiente, não precisa de framework
   dado o tamanho do projeto), hospedado gratuitamente (GitHub Pages é a opção mais simples
   — nota: `C:\Users\Samuel\Desktop\Market_Simulation_Code` **não é atualmente um
   repositório git**, por isso criar/publicar um repositório exige `git init` +
   confirmação explícita do utilizador antes de qualquer `push` ou publicação pública).
   Gráficos com **Chart.js** (substitui os gráficos nativos do Excel — sem os problemas
   de âncora/merge que consumiram várias sessões no Excel).
3. **Stack de desenvolvimento: JavaScript**, não Python. O Apps Script é JS. Python só
   entra num **script único e pontual de migração** (usar `openpyxl`, já usado
   extensivamente neste projeto) para semear a Google Sheet inicial com os dados atuais
   do `.xlsx` — depois desse script correr uma vez, não faz parte da app.
4. **Estratégia de entrega: incremental, começando pelo MVP de leitura, mas desenhado
   desde já como a base da app completa** (schema de dados e API pensados para
   extensão) — não é um protótipo descartável. As fases seguintes só ACRESCENTAM
   (endpoints de escrita, formulários, filtros), não reescrevem o que já existir.
5. **Idioma e nomenclatura**: manter português e os mesmos nomes/emojis usados no
   Excel atual (ex: "🎯 Taxa de Sucesso", "🥧 MULTAS POR TIPO") para consistência visual
   e para os utilizadores reconhecerem a app imediatamente.

## Passo obrigatório antes de escrever qualquer código

**Antes de implementar seja o que for**, propõe ao utilizador que modelo Claude e que
nível de esforço de raciocínio usar para este trabalho, e espera o ajuste dele. Não
avances para código sem essa confirmação explícita.

Pontos a considerar na tua proposta (não são mandato fixo — decide com base no que
encontrares ao inspecionar o estado atual):
- Trabalho de implementação repetitivo (componentes de UI, formulários, chamadas fetch)
  tende a ser bem servido por um modelo mais rápido/barato.
- Decisões de arquitetura/schema de dados, e depuração de bugs de sincronização/
  concorrência mais complicados, beneficiam de mais poder de raciocínio.
- O utilizador já viu esta recomendação numa conversa anterior (Sonnet para a maior
  parte do build, reservando mais esforço/modelo mais capaz para desenho de schema e
  bugs difíceis) — usa isso como ponto de partida, não como resposta já fechada.

## Estado atual a replicar (inspeciona o `.xlsx` diretamente, não confies só nesta lista)

Abre `bet_tracker_calude.xlsx` com `openpyxl` para ver fórmulas/estrutura reais antes de
desenhar o schema da Sheet. Secções existentes por separador:

- **APOSTAS**: registo individual de apostas por boletim (jogador, desporto, odd,
  resultado, multas de atraso/erro calculadas, época).
- **MULTA FALTAS**: registo de jogadores que não enviam pick, com multa progressiva
  mensal (1ª=2.5€, 2ª=2.5+0.5€, 3ª=2.5+1€, 4ª=2.5+2€).
- **LEVANTAMENTOS**: registo simples e coletivo de dinheiro retirado da banca.
- **PERFORMANCE** (o dashboard principal — é o grosso do trabalho a portar):
  - KPIs principais (banca atual, lucro total, taxa de sucesso, odd média, multas
    totais/pendentes, etc.), com filtro por **época desportiva** (seletor único que
    afeta quase tudo, exceto a Banca Atual que é sempre global).
  - Gráfico de evolução da banca ao longo do tempo (line chart).
  - Tabela "Classificação" — ranking dinâmico com várias categorias (maior taxa de
    acerto, maior odd acertada, maior sequência de vitórias/derrotas, maior/pior
    assiduidade, maior contribuição em multas, maior indisciplina), com título que
    reflete a época selecionada.
  - Performance Individual (por jogador): apostas, acertos, taxa, odd mediana
    (acerto/erro), maior odd acertada, sequências máx. vitórias/derrotas, sequência
    atual — com formatação condicional.
  - Multas por Jogador e Multas por Tipo (com gráfico de pizza).
  - Performance por Desporto — global e individual por jogador (inclui MMA).
  - Correlação de acertos entre jogadores (matriz tipo Pearson).
- **CONFIGURAÇÕES**: valor inicial da banca, tabela de multas, lista de jogadores/
  desportos/épocas usados nos dropdowns.

## Roteiro faseado

**Fase 1 (começar aqui):**
1. Desenho do schema de dados no Google Sheets + arquitetura da API do Apps Script
   (pensar já nos endpoints de escrita que virão a seguir, mesmo que não sejam
   implementados agora).
2. Script Python (`openpyxl`) para migrar os dados atuais do `.xlsx` para essa Sheet.

**Fase 2 (MVP de leitura — objetivo desta primeira entrega):**
3. Dashboard HTML/JS só de leitura: KPIs principais + Performance Individual + tabelas.
4. Gráficos (banca, taxas, sequências, multas por tipo) com Chart.js.
5. Filtro por época + Classificação + Correlação.

**Fase 3 (extensão — só depois do MVP estar validado com o utilizador):**
6. Formulários de escrita (registar aposta, multa falta, levantamento) com endpoints
   POST no Apps Script.
7. Identificação de utilizador (login Google simples ou seleção de nome, dado o baixo
   risco entre amigos) + responsivo/mobile.
8. Testes reais com o grupo + correções.

## Restrições a respeitar sempre

- **Zero custos** — não introduzir nenhum serviço que exija cartão de crédito ou que
  possa começar a cobrar com o crescimento normal de uso deste grupo (5 pessoas, uso
  esporádico).
- Antes de `git init`, criar repositório, ou publicar/fazer push de qualquer coisa
  publicamente (GitHub Pages, deployment do Apps Script como "Anyone"), **confirma
  explicitamente com o utilizador** — são ações visíveis/partilhadas, não assumir
  autorização implícita.
- Não apagar nem sobrescrever o `.xlsx` original ou os seus backups — ficam como
  registo histórico mesmo depois da migração.
