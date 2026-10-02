export default function Home() {
  return (
    <main>
      <h1>PFOS — SPIKE-06</h1>
      <p>Login OIDC (Authorization Code + PKCE) ejecutado por el BFF.</p>
      <a href="/api/bff/auth/login?returnTo=/app" data-testid="login">Entrar</a>
    </main>
  );
}
