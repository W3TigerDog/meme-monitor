# Meme Monitor

[English](README.md) | [Français](README.fr.md) | [Português](README.pt.md)

Meme Monitor é um serviço Node.js com painéis para navegador. Ele monitora pares de tokens Solana publicados recentemente no DexScreener, avalia a atividade do mercado e transmite sinais aos clientes conectados em tempo real.

> Este projeto fornece indicadores automatizados de mercado para fins de pesquisa. Ele não constitui aconselhamento financeiro.

## Recursos

- Consulta os perfis e pares recentes da Solana no DexScreener a cada 10 segundos.
- Avalia os pares usando liquidez, idade, volume de 24 horas, atividade de compra e venda, FDV e crescimento de curto prazo da liquidez e do preço.
- Publica os sinais mais recentes por meio de uma API JSON e Server-Sent Events (SSE).
- Inclui painéis com filtros de pontuação, idade, palavra-chave e alerta.
- Oferece visualizações de 10, 15, 30 e 60 minutos.
- Mantém o estado de deduplicação dos sinais de alta pontuação em `seen_pairs.json`.

## Requisitos

- Node.js 18.x
- npm
- Acesso à Internet para usar a API do DexScreener

## Início rápido

```bash
npm ci
npm start
```

Abra [http://localhost:3000](http://localhost:3000) em um navegador.

## Configuração

Crie um arquivo `.env` na raiz do projeto caso precise substituir os valores padrão:

```dotenv
PORT=3000
HELIUS_API_KEY=sua_chave_helius_opcional
```

| Variável | Obrigatória | Descrição |
| --- | --- | --- |
| `PORT` | Não | Porta HTTP. O valor padrão é `3000`. |
| `HELIUS_API_KEY` | Não | Reservada para a integração com o Helius. O servidor atual apenas verifica se ela está presente. |

Os limites de pontuação, a frequência de consulta e as configurações de deduplicação ficam em `monitor.js`. A origem web permitida em produção é definida por `ALLOWED_ORIGIN` em `server.js`; altere-a ao implantar o painel em outro domínio.

## Painéis

| Rota | Descrição |
| --- | --- |
| `/?view=10m` | Painel padrão de 10 minutos |
| `/?view=15m` | Painel V2 de 15 minutos |
| `/?view=30m` | Painel V2 de 30 minutos |
| `/?view=60m` | Painel V2 de 60 minutos |
| `/?view=v2` | Laboratório V2 estendido de 120 minutos |

Todas as visualizações usam um único painel compartilhado, portanto a troca de janela preserva a conexão SSE. As rotas HTML antigas continuam funcionando e redirecionam para a visualização correspondente. Filtros, ordenação, modo compacto e preferências de som são salvos no dispositivo atual.

## API

| Endpoint | Descrição |
| --- | --- |
| `GET /ping` | Verificação de integridade; retorna `pong`. |
| `GET /api/signals` | Retorna até 200 sinais recentes armazenados em memória. |
| `GET /events` | Abre o fluxo SSE de sinais em tempo real. |

Um sinal inclui os endereços do token e do par, seus símbolos, liquidez, FDV, volume, preço, idade, pontuação, motivos da pontuação, data e hora e URL do DexScreener, quando disponíveis.

## Visão geral da pontuação

A pontuação do backend em `monitor.js` considera:

- Liquidez em dólares americanos
- Idade do par
- Volume de negociação de 24 horas
- Pressão de compra e venda em cinco minutos
- Avaliação totalmente diluída (FDV)
- Crescimento da liquidez em um e três minutos
- Crescimento do preço em um e três minutos

Os painéis V2 aplicam uma pontuação adicional no cliente para exibição e filtragem. Todas as pontuações são heurísticas e podem ser afetadas por dados de terceiros ausentes, atrasados ou imprecisos.

## Estrutura do projeto

| Caminho | Finalidade |
| --- | --- |
| `server.js` | Servidor Express, hospedagem dos painéis, API REST e fluxo SSE |
| `monitor.js` | Consulta ativa ao DexScreener e lógica de pontuação do backend |
| `index.js` | Avaliador autônomo legado que grava resultados em `signals.csv` |
| `public/index.html` | Documento compartilhado do painel e controles |
| `public/dashboard-app.js` | Fluxo ao vivo, filtros, ordenação, preferências e renderização DOM segura |
| `public/dashboard-logic.js` | Formatação, validação de URLs, análise de motivos e pontuação V2 |
| `public/dashboard-shell.js` | Layout, navegação, estado da conexão e troca de visualização |
| `public/dashboard.css` | Sistema visual compartilhado e estilos responsivos |
| `test/dashboard.test.js` | Testes Node.js para pontuação, segurança de URLs e rotas antigas |
| `seen_pairs.json` | Estado persistente da deduplicação dos sinais de alta pontuação |
| `signals.csv` | Saída CSV usada pelo avaliador autônomo |

Para executar o avaliador CSV autônomo em vez do serviço web:

```bash
node index.js
```

## Observações operacionais

- Os sinais recentes da API são armazenados em memória e apagados quando o servidor é reiniciado.
- A deduplicação dos sinais de alta pontuação persiste entre reinicializações por meio de `seen_pairs.json`.
- O serviço depende dos formatos de resposta e da disponibilidade do DexScreener.
- O CORS atualmente permite o domínio configurado do GitHub Pages e o desenvolvimento local na porta `3000`.

## Licença

ISC
