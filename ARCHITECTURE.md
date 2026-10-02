# Arquitetura do 001 Online

Esta versão abandona a base anterior com Mongoose/Zod/Helmet/dotenv obrigatórios e usa uma estrutura deliberadamente simples, próxima à do Carpa Diem Online.

## Princípios

- `npm install` + `npm start` precisa funcionar sem configuração externa.
- MongoDB acrescenta persistência, mas não bloqueia o servidor.
- Socket.IO mantém sala e partida em tempo real.
- O servidor é autoritativo para as regras do jogo.
- Desktop e Mobile têm páginas próprias.
- O estado vivo das salas fica em memória; o banco registra histórico quando disponível.

## Módulos

- `server.js`: HTTP, Socket.IO, segurança básica, rotas e eventos.
- `src/game.js`: salas, bots, reconexão, regras e estado autoritativo da partida.
- `src/storage.js`: MongoDB opcional.
- `public/client.js`: interface, seleção de cartas e envio de ações ao servidor.
- `public/common-ui.js`: regras, modais, título, ajuda e ajuste de tela.
