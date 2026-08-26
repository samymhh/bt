# Migração para Google Sheets — passo a passo

Script único e pontual (`migrate_to_sheets.py`) para semear a Google Sheet inicial a partir de
`bet_tracker_calude.xlsx`, conforme o schema em [../docs/SCHEMA.md](../docs/SCHEMA.md). Depois de
correr uma vez, este script deixa de fazer parte da app — a Sheet passa a ser a fonte de verdade.

Tudo aqui é **gratuito** (service account do Google Cloud, sem cartão de crédito necessário para a
Sheets API).

## 1. Criar a Google Sheet de destino

Cria manualmente uma Google Sheet vazia (sheets.google.com) e copia o ID da URL:
`https://docs.google.com/spreadsheets/d/<ESTE_É_O_ID>/edit`

## 2. Criar uma service account no Google Cloud (gratuito)

1. Em [console.cloud.google.com](https://console.cloud.google.com), cria um projeto novo (ou usa
   um existente).
2. Ativa a **Google Sheets API** (APIs & Services → Library → procurar "Google Sheets API" →
   Enable).
3. Cria uma **service account** (APIs & Services → Credentials → Create Credentials → Service
   Account). Não precisa de nenhuma role especial ao nível do projeto.
4. Nessa service account, cria uma **chave** em formato JSON (Keys → Add Key → JSON) e guarda o
   ficheiro localmente (fora do controlo de versões — não fazer commit disto).
5. Copia o email da service account (algo como
   `bet-tracker-migration@<projeto>.iam.gserviceaccount.com`).

## 3. Partilhar a Sheet com a service account

Na Google Sheet criada no passo 1, clica em "Partilhar" e adiciona o email da service account como
**Editor**.

## 4. Instalar dependências e correr

```bash
pip install -r requirements.txt
```

```bash
GOOGLE_APPLICATION_CREDENTIALS=/caminho/para/credenciais.json python migrate_to_sheets.py --sheet-id <ID_DA_SHEET> --dry-run
```

Confirma que as contagens de linhas no `--dry-run` fazem sentido (compara com o número de apostas/
faltas/levantamentos que sabes que existem), depois corre sem `--dry-run` para escrever de facto:

```bash
GOOGLE_APPLICATION_CREDENTIALS=/caminho/para/credenciais.json python migrate_to_sheets.py --sheet-id <ID_DA_SHEET>
```

O script cria (ou limpa, se já existirem) os separadores `Apostas`, `MultaFaltas`,
`Levantamentos`, `Config_Geral`, `Config_Jogadores`, `Config_TiposJornada`, `Config_Desportos`,
`Config_Epocas`, `Config_MultaErros`, `Config_MultaAtrasos`, `Config_MultaFaltas`.
