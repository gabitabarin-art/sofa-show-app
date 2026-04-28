// ============================================================
// TELA DE LOGIN
// ============================================================

import React, { useState } from "react";
import { Lock, Mail, Loader2, AlertCircle, LogIn, Armchair, ArrowLeft, CheckCircle2 } from "lucide-react";
import { supabase } from "./supabaseClient";

export default function LoginScreen() {
  // Modo: "login" | "esqueci"
  const [modo, setModo] = useState("login");

  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sucessoEsqueci, setSucessoEsqueci] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { data, error: errLogin } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password: senha,
      });
      if (errLogin) {
        if (errLogin.message.toLowerCase().includes("invalid login credentials")) {
          setError("E-mail ou senha incorretos. Verifique e tente novamente.");
        } else if (errLogin.message.toLowerCase().includes("email not confirmed")) {
          setError("Sua conta ainda não foi confirmada. Verifique seu e-mail (inclusive a caixa de spam).");
        } else {
          setError("Não foi possível entrar: " + errLogin.message);
        }
        return;
      }
    } catch (e) {
      setError("Erro inesperado ao fazer login: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleEsqueci = async (e) => {
    e.preventDefault();
    setError("");
    setSucessoEsqueci(false);
    if (!email.trim()) {
      setError("Digite seu e-mail.");
      return;
    }
    setLoading(true);
    try {
      const { error: errReset } = await supabase.auth.resetPasswordForEmail(
        email.trim().toLowerCase(),
        { redirectTo: window.location.origin }
      );
      if (errReset) {
        setError("Não foi possível enviar: " + errReset.message);
        return;
      }
      setSucessoEsqueci(true);
    } catch (e) {
      setError("Erro inesperado: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      style={{
        background:
          "linear-gradient(135deg, #7f1d1d 0%, #b91c1c 25%, #dc2626 55%, #ef4444 85%, #fb7185 100%)",
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      {/* Importa as fontes (caso esta tela seja exibida antes do App.jsx montar) */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700;9..144,800&family=Inter:wght@400;500;600;700&display=swap');
        .font-serif { font-family: 'Fraunces', Georgia, serif; }
      `}</style>

      <div className="w-full max-w-md relative z-10">
        {/* Cabeçalho com logo da loja */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-white/15 backdrop-blur-md border-2 border-white/30 mb-5 shadow-2xl">
            <Armchair className="w-10 h-10 text-white" />
          </div>
          <h1
            className="font-serif text-5xl font-extrabold text-white tracking-tight drop-shadow-lg"
            style={{ textShadow: "0 4px 20px rgba(0,0,0,0.25)" }}
          >
            Sofá Show
          </h1>
          <p className="text-sm text-white/90 mt-2 font-medium tracking-wide">
            App exclusivo da empresa
          </p>
        </div>

        {/* Caixa de login branca com sombra forte */}
        <div className="bg-white rounded-2xl shadow-2xl p-7 border border-white/50">
          <div className="mb-5">
            <h2 className="font-serif text-2xl font-bold text-stone-900">
              {modo === "esqueci" ? "Esqueci minha senha" : "Entrar"}
            </h2>
            <p className="text-xs text-stone-600 mt-1">
              {modo === "esqueci"
                ? "Digite seu e-mail e vamos enviar um link pra você criar uma senha nova."
                : "Use seu e-mail e senha cadastrados."}
            </p>
          </div>

          {modo === "login" ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1.5 block">
                  E-mail
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-rose-400 pointer-events-none" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    placeholder="seu@email.com"
                    className="w-full pl-9 pr-3 py-2.5 text-sm border-2 border-stone-200 rounded-lg bg-stone-50 focus:outline-none focus:ring-4 focus:ring-rose-200 focus:border-rose-500 focus:bg-white transition-all"
                    disabled={loading}
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1.5 block">
                  Senha
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-rose-400 pointer-events-none" />
                  <input
                    type="password"
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                    required
                    autoComplete="current-password"
                    placeholder="sua senha"
                    className="w-full pl-9 pr-3 py-2.5 text-sm border-2 border-stone-200 rounded-lg bg-stone-50 focus:outline-none focus:ring-4 focus:ring-rose-200 focus:border-rose-500 focus:bg-white transition-all"
                    disabled={loading}
                  />
                </div>
              </div>

              {error && (
                <div className="bg-red-50 border-2 border-red-200 rounded-lg p-3 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-700 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-red-900">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 text-white font-semibold rounded-lg shadow-lg disabled:opacity-60 disabled:cursor-not-allowed transition-all hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0"
                style={{
                  background:
                    "linear-gradient(135deg, #dc2626 0%, #e11d48 50%, #f43f5e 100%)",
                }}
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Entrando...
                  </>
                ) : (
                  <>
                    <LogIn className="w-4 h-4" />
                    Entrar
                  </>
                )}
              </button>
            </form>
          ) : (
            <form onSubmit={handleEsqueci} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1.5 block">
                  E-mail
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-rose-400 pointer-events-none" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    placeholder="seu@email.com"
                    className="w-full pl-9 pr-3 py-2.5 text-sm border-2 border-stone-200 rounded-lg bg-stone-50 focus:outline-none focus:ring-4 focus:ring-rose-200 focus:border-rose-500 focus:bg-white transition-all"
                    disabled={loading || sucessoEsqueci}
                  />
                </div>
              </div>

              {error && (
                <div className="bg-red-50 border-2 border-red-200 rounded-lg p-3 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-700 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-red-900">{error}</p>
                </div>
              )}

              {sucessoEsqueci && (
                <div className="bg-emerald-50 border-2 border-emerald-200 rounded-lg p-3 flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 mt-0.5 flex-shrink-0" />
                  <div className="text-xs text-emerald-900">
                    <p className="font-semibold mb-0.5">Link enviado!</p>
                    <p>
                      Se houver uma conta com esse e-mail, você vai receber um link em alguns minutos. Verifique inclusive sua caixa de spam.
                    </p>
                  </div>
                </div>
              )}

              {!sucessoEsqueci && (
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 text-white font-semibold rounded-lg shadow-lg disabled:opacity-60 disabled:cursor-not-allowed transition-all hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0"
                  style={{
                    background:
                      "linear-gradient(135deg, #dc2626 0%, #e11d48 50%, #f43f5e 100%)",
                  }}
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Enviando...
                    </>
                  ) : (
                    <>
                      <Mail className="w-4 h-4" />
                      Enviar link de recuperação
                    </>
                  )}
                </button>
              )}
            </form>
          )}

          <div className="mt-5 pt-4 border-t border-stone-200 text-center">
            {modo === "login" ? (
              <button
                onClick={() => {
                  setModo("esqueci");
                  setError("");
                  setSucessoEsqueci(false);
                }}
                className="text-xs text-stone-600 hover:text-rose-600 transition-colors"
                disabled={loading}
              >
                Esqueci minha senha
              </button>
            ) : (
              <button
                onClick={() => {
                  setModo("login");
                  setError("");
                  setSucessoEsqueci(false);
                }}
                className="text-xs text-stone-600 hover:text-rose-600 transition-colors flex items-center gap-1 mx-auto"
                disabled={loading}
              >
                <ArrowLeft className="w-3 h-3" />
                Voltar pro login
              </button>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-white/80 mt-6 font-medium tracking-wide">
          Acesso restrito à equipe Sofá Show
        </p>
      </div>
    </div>
  );
}
