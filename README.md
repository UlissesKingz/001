# 001 — Um jogo de cartas e bits

Versão online reorganizada seguindo a mesma arquitetura simples usada no Carpa Diem Online.

## Rodar localmente

Com Node.js 20+:

```powershell
npm.cmd install
npm.cmd start
```

Depois abra:

- http://localhost:3000

**Não é necessário criar `.env` para testar localmente.** O MongoDB é opcional: se `MONGODB_URI` não estiver configurada, o servidor avisa no terminal e continua funcionando em memória.

## Fluxo

1. `/device.html` — escolha Desktop ou Mobile.
2. `/desktop.html` ou `/mobile.html` — nickname, criar sala ou entrar por código.
3. Lobby — até 4 participantes; host pode adicionar/remover bots.
4. Partida — estado do jogo fica no servidor e é sincronizado por Socket.IO.
5. Reinício — todos os jogadores humanos precisam aceitar; bots não votam.

## MongoDB opcional

No Render, configure `MONGODB_URI` se quiser registrar partidas. Sem MongoDB, o jogo continua funcionando normalmente; apenas o histórico persistente fica desativado.

Variáveis opcionais estão em `.env.example`.

## Admin

Se `ADMIN_PASSWORD` estiver configurada, abra:

- `/dev-salas`

O painel mostra salas vivas e, se MongoDB estiver ativo, partidas recentes.

## Estrutura

```text
admin/
  dev-salas.html
public/
  device.html
  desktop.html
  mobile.html
  manual.html
  client.js
  common-ui.js
  styles.css
src/
  game.js
  storage.js
test/
  game.test.js
server.js
package.json
package-lock.json
render.yaml
```

## Segurança

- servidor valida nickname, código, host e todas as jogadas;
- o cliente nunca envia o estado inteiro da partida;
- compra, atualização, captura, descarte, bloqueios, desconexão, bots e vitória são resolvidos no servidor;
- tokens aleatórios de reconexão ficam no navegador e na memória da sala;
- rate limit de eventos Socket.IO;
- limite de payload;
- restrição de origem opcional via `ALLOWED_ORIGINS` / `APP_ORIGINS`;
- `X-Powered-By` removido e headers básicos de segurança;
- MongoDB é usado apenas pelo servidor.

## Deploy no Render

Build:

```text
npm install
```

Start:

```text
npm start
```

Health check:

```text
/health
```
