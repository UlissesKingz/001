# 001 Online — base segura

Base inicial para publicar o jogo **001 — Um jogo de cartas e bits** com:

- Node.js 24
- Express
- Socket.IO
- MongoDB Atlas / Mongoose
- GitHub
- Render

A interface atual é a versão `v34`, em `public/index.html`.

## 1. Desenvolvimento local

```bash
npm install
cp .env.example .env
# preencha MONGODB_URI e SESSION_SECRET
npm run dev
```

Abra `http://localhost:3000`.

## 2. GitHub

Crie um repositório privado inicialmente e envie estes arquivos.
Nunca envie `.env`.

Sugestões:
- branch principal protegida;
- MFA;
- Dependabot;
- secret scanning;
- revisão antes de merge.

## 3. MongoDB Atlas

Crie um banco exclusivo para o projeto e um usuário de aplicação com
o menor privilégio necessário. Coloque a URI apenas no Render.

O Atlas exige uma lista de acesso de rede e usa TLS nas conexões.
Em produção, restrinja a lista de acesso ao menor conjunto possível.

## 4. Render

O `render.yaml` já inclui:
- runtime Node;
- `npm ci`;
- `npm start`;
- `/health`;
- segredo gerado para sessão;
- placeholders para `APP_ORIGINS` e `MONGODB_URI`.

No Render, configure:

`APP_ORIGINS`
```text
https://SEU-SERVICO.onrender.com
```

Se houver domínio próprio:
```text
https://SEU-SERVICO.onrender.com,https://seu-dominio.com.br
```

`MONGODB_URI`
```text
mongodb+srv://...
```

Depois do primeiro deploy, teste:
- `/`
- `/health`
- `/api/status`

## Arquitetura recomendada para a etapa multiplayer

Frontend
→ HTTPS / Socket.IO
→ Express + servidor autoritativo
→ MongoDB Atlas

O MongoDB ficará responsável por dados persistentes. O estado de cada jogada
será validado no servidor antes de qualquer atualização enviada aos clientes.

## Nota importante

A base atual ainda mantém o jogo local da v31. O próximo passo é migrar a
lógica de partidas online para o servidor: criar/entrar em sala, lobby,
turnos, validação de capturas, reconexão e encerramento.
