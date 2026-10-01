# 001 Online — arquitetura multiplayer

## Fluxo de telas

1. **Device** — escolha Desktop ou Mobile.
2. **Entrada** — nickname, criar sala ou entrar por código.
3. **Lobby** — 2 a 4 participantes, host pode adicionar/remover bots e iniciar.
4. **Jogo** — usa a interface atual do 001.
5. **Reinício** — qualquer humano pode solicitar; todos os demais humanos precisam aceitar. Bots não votam.

O título `001 — Um jogo de cartas e bits`, a animação dos bits, o botão de regras e o rodapé legal permanecem nas telas anteriores ao jogo.

## Servidor

O Socket.IO mantém as salas em memória. Cada sala possui:

- código aleatório de 6 caracteres;
- host;
- assentos 0–3;
- jogadores humanos e bots;
- fase (`lobby` ou `game`);
- número da partida;
- pedido/votos de reinício.

Sessões de sala recebem um token HMAC assinado com `SESSION_SECRET`, usado para reconexão. O token expira em 7 dias e nunca contém segredo do servidor.

## Eventos Socket.IO

### Cliente → servidor

- `room:create`
- `room:join`
- `room:resume`
- `room:addBot`
- `room:removeBot`
- `room:start`
- `room:leave`
- `restart:request`
- `restart:vote`

### Servidor → cliente

- `room:state`
- `game:start`
- `restart:requested`
- `restart:rejected`
- `game:restart`

## Segurança aplicada

- validação Zod de nickname, código, device e votos;
- código de sala gerado com `crypto`;
- token de reconexão assinado por HMAC SHA-256;
- verificação de `Origin`;
- rate limit HTTP e Socket.IO;
- máximo de 4 assentos;
- ações de host verificadas no servidor;
- tamanho máximo de payload do Socket.IO;
- sem segredos no frontend ou GitHub.

## Estado atual desta entrega

A navegação, criação/entrada de sala, lobby, bots e consenso de reinício já estão estruturados. A interface de jogo preserva a versão visual atual.

**Próxima fase obrigatória:** migrar a lógica da partida para um motor autoritativo no servidor. Até essa migração, as jogadas da tela do jogo ainda são executadas pelo motor local herdado do protótipo. Não considerar partidas online competitivas como validadas pelo servidor ainda.

Na fase seguinte, o servidor passará a validar e transmitir: compra, `<atualização>`, `<capturar>`, descarte, `<desconectar>`, `<bloqueio>`, especiais, reciclagem da `<entrada>`, bots e vitória.
