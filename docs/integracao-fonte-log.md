# Como conectar uma fonte de log ao Cybergard

O Cybergard recebe log por push: você (ou um script seu) envia os eventos para
`POST /api/ingest`. Não existe conector automático nesta versão — este guia mostra
como plugar o que você já tem sem escrever integração nenhuma.

## 1. Conectar a fonte e pegar o token

No painel, em **Fontes de log → Conectar fonte**, escolha o tipo e dê um nome.
Você recebe:

- a **URL de ingestão** (`https://seu-dominio/api/ingest`)
- um **token**, mostrado uma única vez — se perder, conecte a fonte de novo.

## 2. Formato do evento

Um evento por linha, em [NDJSON](http://ndjson.org/) (um JSON por linha, sem vírgula entre linhas):

```
{"ocorridoEm":"2026-09-23T14:30:00.000Z","tipoEvento":"login","ator":"ana@empresa.com","ipOrigem":"203.0.113.9","payload":{}}
{"ocorridoEm":"2026-09-23T14:31:05.000Z","tipoEvento":"login_falha","ator":"desconhecido","ipOrigem":"198.51.100.4","payload":{"motivo":"senha incorreta"}}
```

| Campo | Obrigatório | Descrição |
| --- | --- | --- |
| `ocorridoEm` | sim | Data/hora ISO 8601 (UTC) de quando o evento aconteceu — não de quando foi enviado |
| `tipoEvento` | sim | `login`, `login_falha`, ou qualquer rótulo seu (livre, até 100 caracteres) |
| `ator` | não | E-mail ou identificador de quem gerou o evento |
| `ipOrigem` | não | IP de origem, se disponível |
| `payload` | não | Qualquer contexto adicional em JSON |

`tipoEvento: "login"` e `"login_falha"` são os dois nomes que o Cybergard reconhece
para consolidar as métricas de padrão de acesso (o resto do volume conta como
"requisições" genéricas). Use exatamente esses nomes para ativar a detecção de
pico de falha de login e de login fora de horário.

## 3. Enviar com o script pronto

```bash
npx tsx scripts/enviar-logs.ts \
  --url https://seu-dominio/api/ingest \
  --token SEU_TOKEN \
  --file eventos.ndjson
```

Sem `--file`, o script lê de `stdin` — útil pra encadear com o que já exporta seu
painel:

```bash
seu-comando-de-exportar-log | npx tsx scripts/enviar-logs.ts --url ... --token ...
```

O script quebra em lotes de 200 eventos e repete automaticamente em caso de erro
temporário (rede ou 5xx). Limite: 500 eventos por chamada e 120 chamadas por
minuto por fonte — o script já respeita o primeiro; se estourar o segundo, ele
tenta de novo com espera crescente.

## 4. Agendar o envio periódico

**Linux/Mac (cron)** — a cada 5 minutos:

```
*/5 * * * * /usr/bin/node /caminho/para/exportar-e-enviar.sh >> /var/log/cybergard-envio.log 2>&1
```

**Windows (Task Scheduler)** — crie uma tarefa básica, gatilho "repetir a cada 5
minutos", ação "Iniciar um programa": `npx.cmd` com argumentos
`tsx scripts/enviar-logs.ts --url ... --token ... --file eventos.ndjson`.

Gere o `eventos.ndjson` antes de cada envio, sobrescrevendo ou anexando conforme
o que seu painel/sistema conseguir exportar — o Cybergard não se importa se o
mesmo evento aparece duas vezes em execuções diferentes (ele só afeta as
métricas agregadas por hora, não duplica alerta).

## 5. Confirmar que está funcionando

Em **Fontes de log**, o status muda de "pendente" para "conectada" assim que o
primeiro lote é aceito, com a data do último evento recebido. Se aparecer "erro",
o motivo fica registrado ali (geralmente: token errado ou formato de data
inválido).
