// ============================================================
// TELA DE LOGIN
// ============================================================

import React, { useState } from "react";
import { Lock, Mail, Loader2, AlertCircle, LogIn } from "lucide-react";
import { supabase } from "./supabaseClient";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [modoCadastro, setModoCadastro] = useState(false);
  const [sucessoCadastro, setSucessoCadastro] = useState(false);

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
          setError("Sua conta ainda não foi confirmada. Fale com a administradora.");
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

  const handleCadastro = async (e) => {
    e.preventDefault();
    setError("");
    setSucessoCadastro(false);
    if (senha.length < 6) {
      setError("A senha precisa ter pelo menos 6 caracteres.");
      return;
    }
    setLoading(true);
    try {
      const { error: errCadastro } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password: senha,
      });
      if (errCadastro) {
        if (errCadastro.message.toLowerCase().includes("already registered")) {
          setError("Este e-mail já tem conta. Use a tela de Entrar.");
        } else {
          setError("Não foi possível cadastrar: " + errCadastro.message);
        }
        return;
      }
      setSucessoCadastro(true);
      setSenha("");
    } catch (e) {
      setError("Erro inesperado ao cadastrar: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-amber-100 border border-amber-200 mb-4">
            <Lock className="w-6 h-6 text-amber-800" />
          </div>
          <h1 className="font-serif text-3xl font-bold text-stone-900 tracking-tight">
            Sofá Show
          </h1>
          <p className="text-sm text-stone-600 mt-1">
            Sistema de conciliação financeira
          </p>
        </div>

        <div className="bg-white border border-stone-200 rounded-lg shadow-sm p-6">
          <div className="mb-5">
            <h2 className="font-serif text-xl font-semibold text-stone-900">
              {modoCadastro ? "Criar conta" : "Entrar"}
            </h2>
            <p className="text-xs text-stone-600 mt-0.5">
              {modoCadastro
                ? "Após criar a conta, fale com a Gabriela para liberar acesso aos módulos."
                : "Use seu e-mail e senha cadastrados."}
            </p>
          </div>

          <form
            onSubmit={modoCadastro ? handleCadastro : handleLogin}
            className="space-y-4"
          >
            <div>
              <label className="text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1.5 block">
                E-mail
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  placeholder="seu@email.com"
                  className="w-full pl-9 pr-3 py-2 text-sm border border-stone-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-amber-700/30 focus:border-amber-700"
                  disabled={loading}
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1.5 block">
                Senha
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
                <input
                  type="password"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  required
                  autoComplete={modoCadastro ? "new-password" : "current-password"}
                  placeholder={modoCadastro ? "mínimo 6 caracteres" : "sua senha"}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-stone-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-amber-700/30 focus:border-amber-700"
                  disabled={loading}
                />
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-md p-3 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-700 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-red-900">{error}</p>
              </div>
            )}

            {sucessoCadastro && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-md p-3 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-emerald-700 mt-0.5 flex-shrink-0" />
                <div className="text-xs text-emerald-900">
                  <p className="font-semibold mb-0.5">Conta criada com sucesso!</p>
                  <p>
                    Agora fale com a Gabriela para liberar suas permissões nos módulos.
                    Depois, volte aqui e use a tela "Entrar".
                  </p>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-800 text-white font-medium rounded-md hover:bg-amber-900 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {modoCadastro ? "Cadastrando..." : "Entrando..."}
                </>
              ) : (
                <>
                  <LogIn className="w-4 h-4" />
                  {modoCadastro ? "Criar conta" : "Entrar"}
                </>
              )}
            </button>
          </form>

          <div className="mt-5 pt-4 border-t border-stone-200 text-center">
            {modoCadastro ? (
              <button
                onClick={() => {
                  setModoCadastro(false);
                  setError("");
                  setSucessoCadastro(false);
                }}
                className="text-xs text-stone-600 hover:text-amber-800"
                disabled={loading}
              >
                Já tenho conta — <span className="font-semibold">entrar</span>
              </button>
            ) : (
              <button
                onClick={() => {
                  setModoCadastro(true);
                  setError("");
                  setSucessoCadastro(false);
                }}
                className="text-xs text-stone-600 hover:text-amber-800"
                disabled={loading}
              >
                Não tenho conta — <span className="font-semibold">criar conta</span>
              </button>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-stone-500 mt-6">
          Acesso restrito à equipe Sofá Show
        </p>
      </div>
    </div>
  );
}
