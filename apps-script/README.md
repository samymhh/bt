# Apps Script — API de leitura e escrita (Fase 2 + Fase 3)

Código para o Web App ligado à Google Sheet criada na Fase 1. Implementa os endpoints de leitura
(`?action=dashboard`, `?action=config`) e, desde a Fase 3, os de escrita (`registarAposta`,
`registarFalta`, `registarLevantamento`, `marcarPago`) — ver [../docs/SCHEMA.md](../docs/SCHEMA.md)
para o desenho completo.

## Como colocar isto na tua Google Sheet

1. Abre a tua Google Sheet (a que já tem `Apostas`, `Config_*`, etc.).
2. Menu **Extensões → Apps Script**. Abre um editor novo, ligado a esta Sheet.
3. No editor, apaga o conteúdo por omissão de `Code.gs` e cola lá o conteúdo de
   [`Code.gs`](Code.gs) deste repositório.
4. Cria um ficheiro novo (ícone "+" ao lado de "Ficheiros") chamado `Calculo` (o Apps Script
   acrescenta `.gs` sozinho) e cola lá o conteúdo de [`Calculo.gs`](Calculo.gs).
5. Clica no ícone de engrenagem ("Definições do projeto") e confirma que o fuso horário é
   `Europe/Lisbon` (ou ajusta o `appsscript.json` — "Mostrar ficheiro de manifesto 'appsscript.json'"
   nas definições do projeto — para corresponder ao conteúdo de [`appsscript.json`](appsscript.json)).
6. Grava (Ctrl+S) e corre a função `doGet` uma vez manualmente (menu de funções no topo) só para
   autorizar o script a aceder à tua Sheet — vai pedir para escolheres a tua conta Google e aceitar
   permissões. Isto é normal e fica só entre ti e a tua própria Sheet.

## Publicar como Web App

> **Isto torna o URL do endpoint acessível a quem o tiver** (não pesquisável, mas qualquer pessoa
> com o link consegue ler os teus dados de apostas). Só faz este passo quando quiseres mesmo
> partilhar o link com o grupo — não há necessidade de o fazer só para testar localmente (podes
> testar diretamente no editor do Apps Script, ver abaixo).

1. **Implementar → Nova implementação**.
2. Tipo: **Aplicação Web**.
3. "Executar como": **Eu** (a tua conta). "Quem tem acesso": **Qualquer pessoa** (necessário para
   o frontend estático conseguir chamar a API sem cada amigo ter de fazer login OAuth).
4. Implementar. Copia o URL gerado (termina em `/exec`) — é isso que o frontend vai chamar.

## Testar sem publicar

No editor do Apps Script, seleciona a função `doGet` no menu de funções e clica em "Executar" — os
logs mostram se correu sem erros, mas não devolvem o JSON de forma fácil de inspecionar. Para testar
o JSON real mais facilmente, publica a implementação (passo acima) e abre o URL `/exec?action=dashboard`
diretamente no browser.

## Atualizar uma implementação já publicada

Colar código novo em `Code.gs`/`Calculo.gs` no editor **não atualiza sozinho** o URL `/exec` já
publicado — esse URL fica preso à versão que estava lá quando fizeste "Nova implementação". Depois
de colares código atualizado:

1. **Implementar → Gerir implementações**.
2. No ícone de lápis (editar) da implementação que já tens, escolhe **Versão: Nova versão**.
3. **Implementar**. O URL `/exec` mantém-se o mesmo — só o código por trás muda.

Sem este passo o frontend fica dessincronizado do backend (na Fase 3 falhava com
`action desconhecida`; com o `?action=dashboard` novo, o dashboard fica em "A carregar dados...").

## Nota sobre a aba `Config_Epocas`

Deixou de ser lida: as épocas são **derivadas das datas reais** de `Apostas`, `MultaFaltas` e
`Levantamentos` (`epocasDosDados_` em `Calculo.gs`), usando `mes_inicio_epoca` de `Config_Geral`.
Um boletim numa época nova faz essa época aparecer sozinha no seletor, sem pré-preenchimento.
A aba pode ficar na Sheet — é simplesmente ignorada.

**`mes_inicio_epoca` está a 7 (julho).** Com esse valor, qualquer data de 1 de julho em diante já
conta para a época seguinte. Se quiseres que a época só vire a **1 de agosto**, muda essa célula em
`Config_Geral` para `8` — não é preciso mexer em código.

## Página "Configurações" — pré-requisito: coluna `vigente_desde`

A aba **Configurações** da app permite mudar o stake (`montante_por_combinacao`), a odd mínima e
as 3 tabelas de multas **sem afetar boletins já registados** — só os registados a partir da data
escolhida usam o valor novo. Para isto funcionar, adiciona manualmente uma coluna `vigente_desde`
(texto ou data) a estas 4 abas, se ainda não a tiverem:

- `Config_Geral` (a seguir a `valor`)
- `Config_MultaErros` (a seguir a `estado_label`)
- `Config_MultaAtrasos` (a seguir a `multa`)
- `Config_MultaFaltas` (a seguir a `multa`)

Deixa a coluna **vazia** nas linhas já existentes (ficam como o valor "base", sempre em vigor até
haver uma versão mais recente). Sem esta coluna, a app continua a funcionar normalmente, mas
qualquer alteração feita em Configurações fica sem data — deixa de existir a garantia de "só afeta
o futuro" até a coluna ser adicionada. Adicionar/editar jogadores, desportos e tipos de jornada não
precisa desta coluna (não são versionados).

## Cache do dashboard (`?action=dashboard`)

O payload completo (todas as épocas + histórico + config) fica em cache partilhada
(`CacheService.getScriptCache()`) durante 5 minutos. Isto importa sobretudo quando o link é usado
por várias pessoas ao mesmo tempo: só o primeiro pedido nesse intervalo paga o custo de ler a Sheet
e recalcular tudo — os seguintes (de qualquer utilizador) são quase instantâneos.

A cache é **invalidada automaticamente** a seguir a qualquer registo/edição bem-sucedido
(`registarAposta`, `atualizarBoletim`, `registarFalta`, `registarLevantamento`, `marcarPago`) — por
isso nunca se vê um dashboard desatualizado depois de gravar algo, mesmo dentro da janela de 5 min.
Não há nada a configurar; se algum dia quiseres mudar o TTL, é a constante `CACHE_TTL_SEGUNDOS_` no
topo de `Code.gs`.
