import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import * as XLSX from "xlsx";
import {
  Upload,
  FileText,
  FileSpreadsheet,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Search,
  Download,
  Package,
  LayoutGrid,
  GitCompare,
  BarChart3,
  Settings,
  Loader2,
  X,
  ChevronRight,
  ChevronLeft,
  Armchair,
  Palette,
  Plus,
  Trash2,
  Pencil,
  Save,
  Users,
  RotateCcw,
  Landmark,
  CircleDollarSign,
  Eye,
  AlertCircle,
  CreditCard,
  LogOut,
  Mail,
  Lock,
  ClipboardList,
  Wallet,
  ShoppingCart,
  UserPlus,
  ChevronDown,
} from "lucide-react";
import { supabase } from "./supabaseClient";
import LoginScreen from "./LoginScreen";

// ============================================================
// TABELA DE CORES (persistência no Supabase — tabela "cores")
// ============================================================

const DEFAULT_COLOR_TABLE = [
  { codigo: "33302", nome: "MARROM" },
  { codigo: "33300", nome: "CINZA" },
  { codigo: "33303", nome: "AZUL" },
  { codigo: "33305", nome: "CAPPUCCINO" },
  { codigo: "33316", nome: "VERDE" },
  { codigo: "33317", nome: "CINZA AZULADO" },
];

// ============================================================
// TABELA DE TAXAS BLU (negociadas no contrato)
// Linhas = tipo de operação | Colunas = grupo de bandeiras
// As mesmas taxas valem para Blu SS Express e Blu Lupe.
// Persistida no Supabase na tabela "taxas_blu" (linha id=1, JSONB).
// ============================================================

// Identificadores estáveis das linhas (não mudar — usados em lookup)
const TIPOS_OPERACAO_BLU = [
  { id: "debito", nome: "Débito", parcMin: 1, parcMax: 1, ehDebito: true },
  { id: "credito_a_vista", nome: "Crédito à vista", parcMin: 1, parcMax: 1, ehDebito: false },
  { id: "credito_2_6", nome: "Crédito 2x a 6x", parcMin: 2, parcMax: 6, ehDebito: false },
  { id: "credito_7_12", nome: "Crédito 7x a 12x", parcMin: 7, parcMax: 12, ehDebito: false },
  { id: "credito_13_17", nome: "Crédito 13x a 17x", parcMin: 13, parcMax: 17, ehDebito: false },
  { id: "credito_18_21", nome: "Crédito 18x a 21x", parcMin: 18, parcMax: 21, ehDebito: false },
];

// Grupos de bandeiras (colunas)
const GRUPOS_BANDEIRA_BLU = [
  { id: "visa_master", nome: "Visa e Master", bandeiras: ["VISA", "MASTER", "MASTERCARD", "MAESTRO"] },
  { id: "amex_elo", nome: "Amex e Elo", bandeiras: ["AMEX", "AMERICAN EXPRESS", "ELO", "HIPERCARD"] },
];

// Taxas padrão (do print que a Blu disponibilizou)
const DEFAULT_TAXAS_BLU = {
  debito:           { visa_master: 0.99, amex_elo: 2.49 },
  credito_a_vista:  { visa_master: 2.19, amex_elo: 3.69 },
  credito_2_6:      { visa_master: 2.55, amex_elo: 4.05 },
  credito_7_12:     { visa_master: 2.75, amex_elo: 4.25 },
  credito_13_17:    { visa_master: 3.49, amex_elo: 4.99 },
  credito_18_21:    { visa_master: 3.69, amex_elo: 5.19 },
};

// ============================================================
// TABELA DE TAXAS PAGUE VELOZ (negociadas no contrato)
// Estrutura totalmente diferente da Blu:
//   - Linhas = número EXATO de parcelas (Débito + 1x até 21x)
//   - Sem distinção por bandeira (uma única taxa por linha)
//   - Comparamos a "Taxa Pagar" (que é a taxa efetivamente paga pelo lojista)
// Persistida no Supabase na tabela "taxas_pague_veloz" (linha id=1, JSONB).
// ============================================================

// Linhas da tabela PV — id estável + label + nº de parcelas
// (debito é tratado separado; pra crédito, parc = número da linha)
const LINHAS_TAXAS_PV = [
  { id: "debito", nome: "Débito", parc: 0, ehDebito: true },
  ...Array.from({ length: 21 }, (_, i) => ({
    id: `parc_${i + 1}`,
    nome: `${i + 1}x`,
    parc: i + 1,
    ehDebito: false,
  })),
];

// Taxas "Taxa Pagar" da Pague Veloz, copiadas do print
// (4ª coluna do print — última)
const DEFAULT_TAXAS_PV = {
  debito:  1.79,
  parc_1:  3.98,
  parc_2:  4.77,
  parc_3:  5.40,
  parc_4:  5.89,
  parc_5:  6.48,
  parc_6:  7.03,
  parc_7:  7.92,
  parc_8:  8.44,
  parc_9:  9.04,
  parc_10: 9.50,
  parc_11: 9.94,
  parc_12: 10.45,
  parc_13: 11.29,
  parc_14: 11.85,
  parc_15: 12.47,
  parc_16: 12.94,
  parc_17: 13.52,
  parc_18: 14.02,
  parc_19: 15.52,
  parc_20: 16.11,
  parc_21: 16.77,
};

// Identifica a linha da tabela PV a partir de uma venda.
// No CSV PV, parc=0 indica DÉBITO (validamos com dados reais: 96 vendas com parc=0
// todas têm taxa exata de 1,79% que é a taxa de débito do contrato).
// parc=1..21 indica crédito parcelado (1x a 21x).
function identificarLinhaTaxaPV(venda) {
  if (!venda) return null;
  const parc = parseInt(venda.qtdParcelas || 0);

  // Parcelas = 0 OU bandeira Maestro → débito
  const bandeira = String(venda.bandeira || "").toUpperCase();
  if (parc <= 0 || bandeira.includes("MAESTRO")) return "debito";

  // Crédito 1x a 21x
  if (parc >= 1 && parc <= 21) return `parc_${parc}`;

  // Acima de 21x: cai no último (não esperado)
  return "parc_21";
}

// Confere a taxa PV de uma venda contra a tabela negociada.
// Retorna formato compatível com conferirTaxaVenda da Blu.
function conferirTaxaVendaPV(venda, tabelaTaxasPV) {
  const linhaId = identificarLinhaTaxaPV(venda);
  const taxaCobrada = calcularTaxaCobrada(venda.valorBrutoTotal, venda.valorLiquidoTotal);

  if (!linhaId || taxaCobrada == null) {
    return { tipoId: linhaId, grupoId: null, taxaNegociada: null, taxaCobrada, diferenca: null, status: "indeterminado" };
  }

  const taxaNegociada = tabelaTaxasPV?.[linhaId];
  if (typeof taxaNegociada !== "number") {
    return { tipoId: linhaId, grupoId: null, taxaNegociada: null, taxaCobrada, diferenca: null, status: "indeterminado" };
  }

  const TOL = 0.02;
  const diferenca = taxaCobrada - taxaNegociada;
  let status;
  if (Math.abs(diferenca) <= TOL) status = "ok";
  else if (diferenca > 0) status = "acima";
  else status = "abaixo";

  return {
    tipoId: linhaId,
    grupoId: null,           // PV não tem grupo de bandeira
    taxaNegociada,
    taxaCobrada,
    diferenca: Math.round(diferenca * 1000) / 1000,
    status,
  };
}

// Identifica o tipo de operação a partir da venda da Blu
// Retorna o id do tipo (ex: "credito_2_6") ou null se não conseguir identificar
function identificarTipoOperacao(venda) {
  if (!venda) return null;
  const tipo = String(venda.tipo || "").toUpperCase();
  const parc = parseInt(venda.qtdParcelas || 0);

  // Detecta débito por palavra-chave (Blu usa "Débito" ou similares)
  const ehDebito = /D[ÉE]BITO|DEBITO|DEBIT/i.test(tipo);

  if (ehDebito) return "debito";

  // Crédito: classifica pela faixa de parcelas
  if (parc <= 1) return "credito_a_vista";
  for (const t of TIPOS_OPERACAO_BLU) {
    if (t.ehDebito) continue;
    if (parc >= t.parcMin && parc <= t.parcMax) return t.id;
  }
  // Acima de 21x cai no último (caso surja)
  return "credito_18_21";
}

// Identifica o grupo de bandeiras a partir do nome bruto
// Retorna o id do grupo (ex: "visa_master") ou null se desconhecida
function identificarGrupoBandeira(bandeiraRaw) {
  if (!bandeiraRaw) return null;
  const b = String(bandeiraRaw).toUpperCase().trim();
  for (const g of GRUPOS_BANDEIRA_BLU) {
    for (const nome of g.bandeiras) {
      if (b.includes(nome)) return g.id;
    }
  }
  return null;
}

// Calcula a taxa REAL cobrada na venda
// Taxa = (valor_bruto - valor_liquido) / valor_bruto * 100
// Retorna número (% — ex: 2.55) ou null se não dá pra calcular
function calcularTaxaCobrada(valorBruto, valorLiquido) {
  if (!valorBruto || valorBruto <= 0) return null;
  if (typeof valorLiquido !== "number" || isNaN(valorLiquido)) return null;
  const taxaCobrada = ((valorBruto - valorLiquido) / valorBruto) * 100;
  return Math.round(taxaCobrada * 1000) / 1000; // arredonda para 3 casas
}

// Verifica a taxa de uma venda contra a tabela negociada.
// Retorna: { tipoId, grupoId, taxaNegociada, taxaCobrada, diferenca, status }
// status: "ok" | "acima" | "abaixo" | "indeterminado"
function conferirTaxaVenda(venda, tabelaTaxas) {
  const tipoId = identificarTipoOperacao(venda);
  const grupoId = identificarGrupoBandeira(venda.bandeira);
  const taxaCobrada = calcularTaxaCobrada(venda.valorBrutoTotal, venda.valorLiquidoTotal);

  if (!tipoId || !grupoId || taxaCobrada == null) {
    return { tipoId, grupoId, taxaNegociada: null, taxaCobrada, diferenca: null, status: "indeterminado" };
  }

  const taxaNegociada = tabelaTaxas?.[tipoId]?.[grupoId];
  if (typeof taxaNegociada !== "number") {
    return { tipoId, grupoId, taxaNegociada: null, taxaCobrada, diferenca: null, status: "indeterminado" };
  }

  // Tolerância pequena pra diferenças de arredondamento (0,02%)
  const TOL = 0.02;
  const diferenca = taxaCobrada - taxaNegociada; // positivo = cobrou MAIS
  let status;
  if (Math.abs(diferenca) <= TOL) status = "ok";
  else if (diferenca > 0) status = "acima";
  else status = "abaixo";

  return {
    tipoId,
    grupoId,
    taxaNegociada,
    taxaCobrada,
    diferenca: Math.round(diferenca * 1000) / 1000,
    status,
  };
}

// Normaliza nome de cor pra comparação (remove acentos, espaços extras, prefixos de material)
// Lista de materiais que podem aparecer no nome do modelo ou da cor
// Removidos para não confundir o matching
const MATERIAIS = ["VELUDO", "LINHO", "VELVET", "SUEDE", "BOUCLE", "COURO", "CAMURÇA", "CAMURCA", "LINHÃO", "LINHAO"];

function normalizeColorName(name) {
  if (!name) return "";
  let s = name.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  for (const mat of MATERIAIS) {
    s = s.replace(new RegExp(`\\b${mat}\\b`, "g"), "");
  }
  return s
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Remove acentos para comparação de modelo
function removeAcentos(s) {
  return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Limpa o nome do modelo: remove materiais, "+ PUFF", parênteses, etc.
function limparModelo(modelo) {
  if (!modelo) return "";
  let s = modelo.toUpperCase().trim();
  // Remove "+ PUFF" e variações
  s = s.replace(/\s*\+\s*PUFF\b/gi, "");
  // Remove conteúdo entre parênteses: "(2L SEM BRAÇO)"
  s = s.replace(/\([^)]*\)/g, "");
  // Remove materiais
  for (const mat of MATERIAIS) {
    s = s.replace(new RegExp(`\\b${mat}\\b`, "gi"), "");
  }
  // Remove números soltos no final (códigos de cor que escaparam)
  s = s.replace(/\s+\d+\s*$/, "");
  return s.replace(/\s+/g, " ").trim();
}

// Se a medida estiver vazia mas o modelo tiver medida embutida, extrai
function extrairMedidaDoModelo(modelo, medidaAtual) {
  if (medidaAtual && medidaAtual.trim()) return { modelo, medida: medidaAtual };
  if (!modelo) return { modelo, medida: medidaAtual };
  // Procura medida composta: "1,80X3,50", "2.15 X 1.95"
  const mMult = modelo.match(/(\d+[,.]?\d*\s*[Xx]\s*\d+[,.]?\d*)/);
  if (mMult) {
    const novoModelo = (modelo.substring(0, mMult.index) + modelo.substring(mMult.index + mMult[0].length)).trim();
    return { modelo: novoModelo, medida: mMult[1] };
  }
  // Procura medida simples: "1,30", "2,90"
  const mSing = modelo.match(/(?<!\d)(\d+[,.]\d+)(?!\d)/);
  if (mSing) {
    const novoModelo = (modelo.substring(0, mSing.index) + modelo.substring(mSing.index + mSing[0].length)).trim();
    return { modelo: novoModelo, medida: mSing[1] };
  }
  return { modelo, medida: medidaAtual };
}

// ============================================================
// PARSERS
// ============================================================

// Extrai produtos do relatório de estoque negativo do SIFAT (PDF ou planilha convertidos em texto)
// Formato típico: "9213 ESTOF CANTO CUBA 2,50X2,50 COR 33302 MARROM // 1 -1 -1 UN ..."
function parseSifatText(rawText) {
  const items = [];
  const lines = rawText.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const codeMatch = trimmed.match(/^(\d{3,6})\s+(.+)/);
    if (!codeMatch) continue;

    const codigo = codeMatch[1];
    let resto = codeMatch[2];

    if (/total|folha|código|descri|fl -|produto fora/i.test(resto)) continue;

    // Quantidade disponível — padrão "// 1 -2 -2 UN" (o segundo número negativo é a qtde em falta)
    const qtyMatch = resto.match(/\/\/\s*\S*\s*(-?\d+)\s+(-?\d+)\s+UN/i);
    const qtdeDisponivel = qtyMatch ? parseInt(qtyMatch[2], 10) : null;

    if (qtdeDisponivel === null || qtdeDisponivel >= 0) continue;

    const descMatch = resto.match(/^(.+?)\/\//);
    const descricao = descMatch ? descMatch[1].trim() : resto.trim();

    const parsed = parseDescricao(descricao);

    items.push({
      codigo,
      descricao,
      quantidadeNegativa: Math.abs(qtdeDisponivel),
      ...parsed,
    });
  }

  return items;
}

// "ESTOF CUBA 2,50 COR 33302 MARROM" → { modelo:"CUBA", medida:"2.50", corCodigo:"33302", corNome:"MARROM" }
// Também lida com "ESTOF TIGUAN 3,50 C/2 MOD 1,00 E C/1 CHAISE" (não tem "COR ...")
function parseDescricao(desc) {
  if (!desc) return { modelo: "", medida: "", corCodigo: "", corNome: "" };

  let s = desc.toUpperCase().trim();
  s = s.replace(/^ESTOF(?:ADO)?\s+/i, "");

  // Se tem "C/n MOD...", corta tudo a partir daí ANTES de procurar medida/cor
  // (isso evita pegar "1,00" como medida em "TIGUAN 3,50 C/2 MOD 1,00 E C/1 CHAISE")
  s = s.replace(/\s+C\s*\/\s*\d+.*$/i, "").trim();

  let corCodigo = "";
  let corNome = "";
  const corMatch = s.match(/\bCOR\s+(.+)$/i);
  if (corMatch) {
    const corTxt = corMatch[1].trim();
    const codMatch = corTxt.match(/^([\w-]+)/);
    // Só considera código se tiver pelo menos um dígito (ex: "33302", "3040-02", "C-426")
    // "MARROM" sozinho NÃO é código.
    if (codMatch && /\d/.test(codMatch[1])) {
      corCodigo = codMatch[1].replace(/^-/, "");
      corNome = corTxt.substring(codMatch[0].length).trim();
    } else {
      corNome = corTxt;
    }
    s = s.substring(0, corMatch.index).trim();
  }

  let medida = "";
  // Tenta medida composta primeiro: "2,50X2,50", "1,80X2,70"
  const medMatchMult = s.match(/(\d+[,.]?\d*\s*[Xx]\s*\d+[,.]?\d*)/);
  if (medMatchMult) {
    medida = normalizeMedida(medMatchMult[1]);
    s = s.replace(medMatchMult[1], "").trim();
  } else {
    // Medida simples: "2,50", "1,90", "2 L", "3 L"
    const medMatchSingle = s.match(/(\d+[,.]\d+|\d+\s*L\b)/);
    if (medMatchSingle) {
      medida = normalizeMedida(medMatchSingle[1]);
      s = s.replace(medMatchSingle[1], "").trim();
    }
  }

  s = s.replace(/\s+/g, " ").trim();
  s = limparModelo(s); // remove materiais, "+ PUFF", parênteses

  return { modelo: s, medida, corCodigo: corCodigo.toUpperCase(), corNome };
}

function parsePedidoRow(row) {
  let modeloRaw = String(row["MODELO"] || "").toUpperCase().trim();
  let medidaRaw = String(row["MEDIDA"] || "").trim();
  const corRaw = String(row["COR"] || "").toUpperCase().trim();
  const quant = Number(row["QUANT"] || 0);

  // BUG 1: Se a medida estiver vazia mas o modelo tiver medida embutida, extrair
  const extraido = extrairMedidaDoModelo(modeloRaw, medidaRaw);
  modeloRaw = extraido.modelo;
  medidaRaw = extraido.medida;

  const medida = normalizeMedida(medidaRaw);
  const modelo = limparModelo(modeloRaw); // BUGS 3, 4: remove materiais, "+ PUFF"

  // BUG 2: Cor pode vir com prefixo material, ex: "LINHO 02 BEGE" → código "02"
  let corSemMaterial = corRaw;
  for (const mat of MATERIAIS) {
    corSemMaterial = corSemMaterial.replace(new RegExp(`\\b${mat}\\b`, "g"), "").trim();
  }
  corSemMaterial = corSemMaterial.replace(/\s+/g, " ").trim();

  let corCodigo = "";
  let corNome = corRaw;
  const codMatch = corSemMaterial.match(/^([\w-]+)(?:\s*-\s*|\s+)?(.*)$/);
  if (codMatch) {
    const possibleCode = codMatch[1];
    if (/\d/.test(possibleCode)) {
      corCodigo = possibleCode;
      corNome = (codMatch[2] || "").replace(/^-\s*/, "").trim();
    }
  }

  return {
    modelo,
    medida,
    corCodigo: corCodigo.toUpperCase(),
    corNome,
    quantidade: quant,
    fornecedor: String(row["FORNECEDOR"] || "").trim(),
    cliente: String(row["CLIENTE"] || "").trim(),
    numeroPedido: String(row["NUMERO PEDIDO"] || "").trim(),
    data: String(row["DATA"] || "").trim(),
    obs: String(row["OBS"] || "").trim(),
    raw: row,
  };
}

// Normaliza medida para comparação:
//   "2,50" → "2.50"      "2.5" → "2.50"       "2 L" → "2L"
//   "2,50X2,50" → "2.50X2.50"     "2.5 x 2.5" → "2.50X2.50"
function normalizeMedida(m) {
  if (!m) return "";
  let s = m.replace(/,/g, ".").toUpperCase().replace(/\s+/g, "");
  // Medida composta (AxB): normaliza cada lado separadamente
  const multMatch = s.match(/^(\d+\.?\d*)X(\d+\.?\d*)$/);
  if (multMatch) {
    const a = padMedida(multMatch[1]);
    const b = padMedida(multMatch[2]);
    return `${a}X${b}`;
  }
  return padMedida(s);
}

// "2" → "2", "2.5" → "2.50", "2.50" → "2.50", "2L" → "2L"
function padMedida(s) {
  if (/^\d+\.\d$/.test(s)) return s + "0"; // "2.5" → "2.50"
  return s;
}

function itemsMatch(sifatItem, pedidoItem, colorTable = []) {
  // Resolve código da cor usando a tabela de sinônimos se necessário
  const sifatCor = resolveColorCode(sifatItem, colorTable);
  const pedidoCor = resolveColorCode(pedidoItem, colorTable);

  // Se SIFAT não tem cor identificável, casa por modelo+medida apenas
  // (caso típico: TIGUAN vem sem campo "COR" na descrição)
  const sifatSemCor = !sifatCor;

  if (!sifatSemCor) {
    if (!pedidoCor) return false;
    if (sifatCor !== pedidoCor) return false;
  }

  // BUG 6: Match flexível de modelo por palavras-chave
  // Ex: "POLTRONA CONFORTO" (SIFAT) deve casar com "POLTRONA CONFORTO + PUFF" (pedido)
  // Ex: "PUFF MUNIQUE" deve casar com "PUFF CANTO MUNIQUE"
  const sModeloNorm = removeAcentos(sifatItem.modelo).trim();
  const pModeloNorm = removeAcentos(pedidoItem.modelo).trim();

  if (!sModeloNorm || !pModeloNorm) return false;

  const GENERICAS = new Set(["DE", "DA", "DO", "E", "+"]);
  const sPalavras = new Set(
    sModeloNorm.split(/\s+/).filter((w) => w && !GENERICAS.has(w) && w.length >= 2)
  );
  const pPalavras = new Set(
    pModeloNorm.split(/\s+/).filter((w) => w && !GENERICAS.has(w) && w.length >= 2)
  );

  if (sPalavras.size === 0 || pPalavras.size === 0) return false;

  // SIFAT está contido no pedido OU pedido contido no SIFAT
  const sIncluidoEmP = [...sPalavras].every((w) => pPalavras.has(w));
  const pIncluidoEmS = [...pPalavras].every((w) => sPalavras.has(w));
  if (!sIncluidoEmP && !pIncluidoEmS) return false;

  const sMed = normalizeMedida(sifatItem.medida);
  const pMed = normalizeMedida(pedidoItem.medida);

  // BUG 7: SIFAT sem medida casa com pedido de qualquer medida
  // (ex: "ESTOF CANTO MUNIQUE + PUFF" sem medida casa com "CANTO MUNIQUE + PUFF 2,15X1,95")
  if (!sMed) return true;
  // Se SIFAT tem medida mas pedido não tem, não casa (medida é obrigatória)
  if (!pMed) return false;

  // IMPORTANTE: medida com "X" (canto) é PRODUTO DIFERENTE de medida sem "X" (sofá reto)
  const sTemX = sMed.includes("X");
  const pTemX = pMed.includes("X");
  if (sTemX !== pTemX) return false;

  if (sMed === pMed) return true;

  // Só compara numericamente quando NENHUM dos dois tem X
  if (!sTemX && !pTemX) {
    const sNum = parseFloat(sMed);
    const pNum = parseFloat(pMed);
    if (!isNaN(sNum) && !isNaN(pNum) && Math.abs(sNum - pNum) < 0.01) return true;
  }

  return false;
}

// Retorna o código normalizado da cor. Se o item só tem nome, tenta resolver via tabela.
function resolveColorCode(item, colorTable) {
  const cod = (item.corCodigo || "").replace(/^0+/, "").toUpperCase();
  if (cod) return cod;

  // Sem código explícito → tenta extrair um código numérico de dentro do nome
  // Ex: "MARROM TOSTADO 100828" → código "100828"
  //     "MARROM 11" → código "11"
  //     "LINHO 78 CHAMPAGNE" → "78" (após remover material)
  let nome = (item.corNome || "").toUpperCase().trim();
  // Remove materiais antes de procurar código embarcado
  for (const mat of MATERIAIS) {
    nome = nome.replace(new RegExp(`\\b${mat}\\b`, "g"), "").trim();
  }
  nome = nome.replace(/\s+/g, " ").trim();

  const embeddedCode = nome.match(/\b(\d{2,}|\d+-\d+|[A-Z]?-?\d+)\b/);
  if (embeddedCode) {
    return embeddedCode[1].replace(/^0+/, "").toUpperCase();
  }

  // Sem código nenhum → tenta bater pelo nome usando a tabela (match exato normalizado)
  const nomeNorm = normalizeColorName(nome);
  if (!nomeNorm) return "";

  for (const entry of colorTable) {
    const entryNome = normalizeColorName(entry.nome);
    if (!entryNome) continue;
    // Match exato apenas (evita falso positivo com "MARROM" casando "MARROM TOSTADO")
    if (entryNome === nomeNorm) {
      return entry.codigo.replace(/^0+/, "").toUpperCase();
    }
  }

  return "";
}

// ============================================================
// LEITORES DE ARQUIVO
// ============================================================

async function readPedidosFile(file) {
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

  return rows
    .filter((r) => r["MODELO"] && r["QUANT"])
    .map(parsePedidoRow);
}

async function readSifatFile(file) {
  const name = file.name.toLowerCase();

  if (name.endsWith(".pdf")) {
    return await readSifatPdf(file);
  }

  if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv")) {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const csv = XLSX.utils.sheet_to_csv(sheet, { FS: " ", RS: "\n" });
    return parseSifatText(csv);
  }

  const text = await file.text();
  return parseSifatText(text);
}

async function readSifatPdf(file) {
  if (!window.pdfjsLib) {
    await loadPdfJs();
  }
  const data = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data }).promise;
  let fullText = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const lines = {};
    for (const item of content.items) {
      const y = Math.round(item.transform[5]);
      if (!lines[y]) lines[y] = [];
      lines[y].push({ x: item.transform[4], str: item.str });
    }
    const sortedY = Object.keys(lines).sort((a, b) => b - a);
    for (const y of sortedY) {
      lines[y].sort((a, b) => a.x - b.x);
      fullText += lines[y].map((i) => i.str).join(" ") + "\n";
    }
  }
  return parseSifatText(fullText);
}

function loadPdfJs() {
  return new Promise((resolve, reject) => {
    if (window.pdfjsLib) return resolve();
    const script = document.createElement("script");
    script.src =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    script.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      resolve();
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

// ============================================================
// CONCILIAÇÃO FINANCEIRA — PARSERS
// ============================================================

const TOLERANCIA_DIAS = 4;

// Lista de bancos suportados
// Bancos do tipo "extrato" usam o fluxo Sicredi (ERP + extrato).
// Bancos do tipo "blu" usam o fluxo Blu (Excel da Blu + PDF do ERP por seção, match por NSU).
// Bancos do tipo "pague_veloz" usam o fluxo PV (CSV PV + PDF do ERP por seção, match por NSU/Cod.Autorização).
// Bancos do tipo "pague_veloz_pix" usam o fluxo PV PIX (extrato PV + PDF do ERP, match por valor + mês).
const BANCOS_SUPORTADOS = [
  { id: "sicredi", nome: "Sicredi", tipo: "extrato", cor: "emerald" },
  { id: "blu_ss", nome: "Blu SS Express", tipo: "blu", secaoPdf: "BLU SS EXPRESS", cor: "purple" },
  { id: "blu_lupe", nome: "Blu Lupe", tipo: "blu", secaoPdf: "BLU LUPE", cor: "purple" },
  { id: "pague_veloz_express", nome: "Pague Veloz Express", tipo: "pague_veloz", secaoPdf: "CARTÃO VELOZ EXP", cor: "blue" },
  { id: "pague_veloz_pix", nome: "Pague Veloz PIX", tipo: "pague_veloz_pix", secaoPdf: "PIX VELOZ EXPRES", cor: "blue" },
];

// Converte "R$ -1.234,56" ou "1234,56" ou "-1,234.56" em número
function parseValor(s) {
  if (s === null || s === undefined) return NaN;
  if (typeof s === "number") return s;
  let str = String(s).trim();
  if (!str) return NaN;
  // Remove R$, espaços
  str = str.replace(/R\$/gi, "").replace(/\s/g, "");
  // Detecta formato BR (1.234,56) vs US (1,234.56)
  const ultimaVirgula = str.lastIndexOf(",");
  const ultimoPonto = str.lastIndexOf(".");
  if (ultimaVirgula > ultimoPonto) {
    // Formato BR: ponto é separador de milhar, vírgula é decimal
    str = str.replace(/\./g, "").replace(",", ".");
  } else if (ultimoPonto > ultimaVirgula && ultimaVirgula >= 0) {
    // Formato US: vírgula é separador de milhar
    str = str.replace(/,/g, "");
  } else if (ultimaVirgula >= 0 && ultimoPonto < 0) {
    // Só vírgula → decimal
    str = str.replace(",", ".");
  }
  const num = parseFloat(str);
  return isNaN(num) ? NaN : num;
}

// Converte "01/04/2026" ou "01/04" ou "2026-04-01" em Date
function parseData(s, anoFallback) {
  if (!s) return null;
  if (s instanceof Date) return s;
  const str = String(s).trim();

  // Formato ISO: 2026-04-01
  let m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));

  // Formato BR completo: 01/04/2026
  m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));

  // Formato BR curto: 01/04
  m = str.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m && anoFallback) return new Date(anoFallback, parseInt(m[2]) - 1, parseInt(m[1]));

  return null;
}

// Diferença em dias entre 2 datas
function diffDias(d1, d2) {
  if (!d1 || !d2) return Infinity;
  const ms = Math.abs(d1.getTime() - d2.getTime());
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

// Formata Date para string DD/MM/YYYY
function formatarData(d) {
  if (!d) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

// Formata número como moeda BR
function formatarMoeda(n) {
  if (typeof n !== "number" || isNaN(n)) return "—";
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });
}

// ----- PARSER DO ERP (Sofá Show interno) -----
// Formato: linhas tipo "01/04 10 Transferência para conta SS PALESTINA -30,000.00"
// Saldos e cabeçalhos são ignorados.
function parseErpText(rawText) {
  const items = [];
  const linhas = rawText.split(/\r?\n/);
  let anoAtual = new Date().getFullYear();

  // Tenta detectar o ano no cabeçalho
  for (const linha of linhas.slice(0, 30)) {
    const m = linha.match(/(\d{2}\/\d{2}\/(\d{4}))/);
    if (m) {
      anoAtual = parseInt(m[2]);
      break;
    }
  }

  // Detecta mês a partir de seções "MARÇO/2026", "ABRIL/2026"
  const mesesPt = {
    JANEIRO: 0, FEVEREIRO: 1, MARÇO: 2, MARCO: 2, ABRIL: 3,
    MAIO: 4, JUNHO: 5, JULHO: 6, AGOSTO: 7, SETEMBRO: 8,
    OUTUBRO: 9, NOVEMBRO: 10, DEZEMBRO: 11,
  };

  for (const linhaRaw of linhas) {
    const linha = linhaRaw.trim();
    if (!linha) continue;

    // Atualiza ano se vier seção tipo "ABRIL/2026"
    const mAno = linha.match(/^([A-ZÇÃ]+)\/(\d{4})/i);
    if (mAno) {
      const mesNome = mAno[1].toUpperCase().replace("Ç", "C").replace("Ã", "A");
      if (mesesPt[mesNome] !== undefined) {
        anoAtual = parseInt(mAno[2]);
      }
      continue;
    }

    // Ignora cabeçalhos e linhas de totais/saldo
    // ATENÇÃO: "saldo" e "total" só descarta quando estão no INÍCIO da linha
    // (linha começa com "Saldo Anterior", "Saldo atual", "Total Créditos:" etc.)
    // pra não descartar lançamentos válidos com "SALDO A PAGAR" no histórico.
    if (
      /^(saldo|total)\b/i.test(linha) ||
      /p[áa]g\.|^data\s|fl\s*-|produto fora|extrato\b|per[ií]odo|associado|cooperativa|conta:\s*\d|cabe\u00e7alho/i.test(
        linha
      )
    )
      continue;

    // Padrão: "DD/MM <documento> <histórico> <valor>"
    // Valor sempre no fim da linha, formato BR ou US, possivelmente negativo
    const m = linha.match(
      /^(\d{1,2}\/\d{1,2})\s+(\S+)\s+(.+?)\s+(-?[\d.,]+\.\d{2})\s*$/
    );
    if (!m) continue;

    const dataStr = m[1];
    const documento = m[2];
    const historico = m[3].trim();
    const valor = parseValor(m[4]);

    if (isNaN(valor) || valor === 0) continue;

    const data = parseData(dataStr, anoAtual);
    if (!data) continue;

    items.push({
      origem: "erp",
      data,
      dataStr: formatarData(data),
      documento,
      historico,
      valor,
      raw: linha,
    });
  }

  return items;
}

// ----- PARSER DO ERP (Excel) -----
function parseErpExcel(rows) {
  const items = [];
  // Tenta achar nomes de colunas comuns
  const aliases = {
    data: ["data", "dt", "data lancamento", "data_lancamento", "data lançamento"],
    historico: ["histórico", "historico", "descrição", "descricao", "descrição lançamento", "descricao lançamento"],
    documento: ["lançamento", "lancamento", "documento", "doc", "nº doc", "n doc"],
    valor: ["valor", "valor r$", "valor (r$)", "vl", "vlr"],
    debito: ["débito", "debito", "saída", "saida"],
    credito: ["crédito", "credito", "entrada"],
  };

  const findCol = (row, nomes) => {
    const keys = Object.keys(row).map((k) => k.toLowerCase().trim());
    for (const nome of nomes) {
      const idx = keys.findIndex((k) => k === nome || k.includes(nome));
      if (idx >= 0) return Object.keys(row)[idx];
    }
    return null;
  };

  if (!rows.length) return [];

  const sample = rows[0];
  const colData = findCol(sample, aliases.data);
  const colHist = findCol(sample, aliases.historico);
  const colDoc = findCol(sample, aliases.documento);
  const colValor = findCol(sample, aliases.valor);
  const colDeb = findCol(sample, aliases.debito);
  const colCred = findCol(sample, aliases.credito);

  for (const row of rows) {
    const dataRaw = colData ? row[colData] : null;
    if (!dataRaw) continue;
    const data = parseData(dataRaw);
    if (!data) continue;

    let valor = NaN;
    if (colValor) {
      valor = parseValor(row[colValor]);
    } else if (colDeb || colCred) {
      const deb = colDeb ? parseValor(row[colDeb]) : 0;
      const cred = colCred ? parseValor(row[colCred]) : 0;
      if (!isNaN(deb) && deb !== 0) valor = -Math.abs(deb);
      else if (!isNaN(cred) && cred !== 0) valor = Math.abs(cred);
    }

    if (isNaN(valor) || valor === 0) continue;

    items.push({
      origem: "erp",
      data,
      dataStr: formatarData(data),
      documento: colDoc ? String(row[colDoc] || "").trim() : "",
      historico: colHist ? String(row[colHist] || "").trim() : "",
      valor,
      raw: row,
    });
  }

  return items;
}

// ----- PARSER DO EXTRATO SICREDI -----
// Formato: "01/04/2026 LIQUIDACAO BOLETO 34086990000144 WAYBE SOLUCOES -314,00 10.226,16"
function parseSicrediText(rawText) {
  const items = [];
  const linhas = rawText.split(/\r?\n/);

  for (const linhaRaw of linhas) {
    const linha = linhaRaw.trim();
    if (!linha) continue;
    if (
      /saldo anterior|saldo atual|saldo da conta|saldo bloqueado|saldo de investimentos|limite|cheque especial|sicredi fone|sac|ouvidoria|cooperativa|associado|extrato|per[íi]odo|^data\s+descri/i.test(
        linha
      )
    )
      continue;

    // Padrão: "DD/MM/YYYY <descrição com possível documento> <valor> <saldo>"
    // O ÚLTIMO número é o saldo, o PENÚLTIMO é o valor da movimentação
    const m = linha.match(
      /^(\d{1,2}\/\d{1,2}\/\d{4})\s+(.+?)\s+(-?[\d.,]+)\s+(-?[\d.,]+)\s*$/
    );
    if (!m) continue;

    const dataStr = m[1];
    let descricao = m[2].trim();
    const valor = parseValor(m[3]);

    if (isNaN(valor) || valor === 0) continue;

    const data = parseData(dataStr);
    if (!data) continue;

    // Tenta extrair documento (CPF/CNPJ ou número de referência) da descrição
    let documento = "";
    const docMatch = descricao.match(/\b(\d{11}|\d{14}|CX\d+|PIX_DEB|PIX_CRED|\d{6,})\b/);
    if (docMatch) {
      documento = docMatch[1];
    }

    items.push({
      origem: "sicredi",
      data,
      dataStr: formatarData(data),
      documento,
      historico: descricao,
      valor,
      raw: linha,
    });
  }

  return items;
}

// ----- LEITORES DE ARQUIVO (geral, ERP e bancos) -----
async function readErpFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) {
    if (!window.pdfjsLib) await loadPdfJs();
    const data = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data }).promise;
    let texto = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const linhas = {};
      for (const item of content.items) {
        const y = Math.round(item.transform[5]);
        if (!linhas[y]) linhas[y] = [];
        linhas[y].push({ x: item.transform[4], str: item.str });
      }
      const ys = Object.keys(linhas).sort((a, b) => b - a);
      for (const y of ys) {
        linhas[y].sort((a, b) => a.x - b.x);
        texto += linhas[y].map((i) => i.str).join(" ") + "\n";
      }
    }
    return parseErpText(texto);
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv")) {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    return parseErpExcel(rows);
  }
  // Texto puro
  const txt = await file.text();
  return parseErpText(txt);
}

async function readBancoFile(file, bancoId) {
  const name = file.name.toLowerCase();
  let texto = "";

  if (name.endsWith(".pdf")) {
    if (!window.pdfjsLib) await loadPdfJs();
    const data = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data }).promise;
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const linhas = {};
      for (const item of content.items) {
        const y = Math.round(item.transform[5]);
        if (!linhas[y]) linhas[y] = [];
        linhas[y].push({ x: item.transform[4], str: item.str });
      }
      const ys = Object.keys(linhas).sort((a, b) => b - a);
      for (const y of ys) {
        linhas[y].sort((a, b) => a.x - b.x);
        texto += linhas[y].map((i) => i.str).join(" ") + "\n";
      }
    }
  } else if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv")) {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    texto = XLSX.utils.sheet_to_csv(sheet, { FS: " ", RS: "\n" });
  } else {
    texto = await file.text();
  }

  if (bancoId === "sicredi") return parseSicrediText(texto);
  // Por enquanto só Sicredi tem parser próprio
  return parseSicrediText(texto);
}

// ----- ALGORITMO DE CONCILIAÇÃO FINANCEIRA -----
// Regra: valor exato + data dentro de TOLERANCIA_DIAS
// Quando houver múltiplos candidatos com mesmo valor, casa o mais próximo na data
// e marca os matches como "conferir" se houver ambiguidade.
function conciliarFinanceiro(erpItems, bancoItems) {
  // Cópias mutáveis
  const erp = erpItems.map((it, idx) => ({ ...it, _idx: idx, _usado: false }));
  const banco = bancoItems.map((it, idx) => ({ ...it, _idx: idx, _usado: false }));

  const conciliados = []; // { erp, banco, diffDias, conferir }
  const soNoErp = [];
  const soNoBanco = [];

  // Passo 1: matches exatos (valor + data igual)
  for (const e of erp) {
    if (e._usado) continue;
    for (const b of banco) {
      if (b._usado) continue;
      if (Math.abs(e.valor - b.valor) > 0.005) continue;
      if (diffDias(e.data, b.data) === 0) {
        e._usado = true;
        b._usado = true;
        conciliados.push({ erp: e, banco: b, diffDias: 0, conferir: false });
        break;
      }
    }
  }

  // Passo 2: matches com tolerância de data
  for (const e of erp) {
    if (e._usado) continue;
    let melhor = null;
    let melhorDiff = Infinity;
    for (const b of banco) {
      if (b._usado) continue;
      if (Math.abs(e.valor - b.valor) > 0.005) continue;
      const d = diffDias(e.data, b.data);
      if (d <= TOLERANCIA_DIAS && d < melhorDiff) {
        melhor = b;
        melhorDiff = d;
      }
    }
    if (melhor) {
      e._usado = true;
      melhor._usado = true;
      conciliados.push({ erp: e, banco: melhor, diffDias: melhorDiff, conferir: melhorDiff > 0 });
    }
  }

  // Passo 3: marca múltiplos lançamentos do mesmo valor como "conferir"
  // (se 3 boletos R$ 70 no banco, todos os 3 matches recebem conferir=true)
  const valorContagem = {};
  for (const c of conciliados) {
    const key = c.erp.valor.toFixed(2);
    valorContagem[key] = (valorContagem[key] || 0) + 1;
  }
  for (const c of conciliados) {
    const key = c.erp.valor.toFixed(2);
    if (valorContagem[key] > 1) c.conferir = true;
  }

  // Passo 4: o que sobrou são divergências
  for (const e of erp) {
    if (!e._usado) soNoErp.push(e);
  }
  for (const b of banco) {
    if (!b._usado) soNoBanco.push(b);
  }

  return { conciliados, soNoErp, soNoBanco };
}

// ============================================================
// CONCILIAÇÃO BLU — PARSERS E MATCHER
// ============================================================

// Normaliza chave de match (NSU):
// - Numérica: tira zeros à esquerda  ("084836" → "84836")
// - Alfanumérica: mantém como está em maiúsculas ("HMZCDJ" → "HMZCDJ")
function normalizarChaveBlu(s) {
  if (s == null) return "";
  const str = String(s).trim().toUpperCase();
  if (/^\d+$/.test(str)) {
    return str.replace(/^0+/, "") || "0";
  }
  return str;
}

// Lê o Excel da Blu (extrato-vendas-completo-XXXX.xlsx).
// Agrupa por codigo_nsu somando valor_bruto_parcela.
async function readBluExcel(file) {
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: "array", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const linhas = XLSX.utils.sheet_to_json(sheet, { defval: null });

  const vendasPorNsu = new Map();

  for (const l of linhas) {
    const nsu = String(l.codigo_nsu ?? "").trim();
    if (!nsu) continue;

    if (!vendasPorNsu.has(nsu)) {
      vendasPorNsu.set(nsu, {
        nsu,
        autorizacao: String(l.codigo_autorizacao ?? "").trim().toUpperCase(),
        chaveMatch: normalizarChaveBlu(l.codigo_autorizacao),
        dataVenda: l.data_venda instanceof Date ? l.data_venda : parseData(l.data_venda),
        bandeira: l.bandeira || "",
        tipo: l.tipo || "",
        qtdParcelas: l.quantidade_parcelas || 0,
        status: l.status_venda || "",
        valorBrutoTotal: 0,
        valorLiquidoTotal: 0,
        parcelasNoExtrato: 0,
        terminal: l.numero_terminal || "",
      });
    }

    const v = vendasPorNsu.get(nsu);
    v.valorBrutoTotal += parseFloat(l.valor_bruto_parcela || 0);
    v.valorLiquidoTotal += parseFloat(l.valor_liquido_parcela || 0);
    v.parcelasNoExtrato += 1;
  }

  return Array.from(vendasPorNsu.values());
}

// Lê o CSV da Pague Veloz (relatorio-operacoes.csv) e devolve as vendas
// no MESMO formato que readBluExcel — pra reaproveitar o conciliarBlu.
// Cada linha do CSV é uma venda (não há agrupamento por parcela como na Blu).
async function readPagueVelozCsv(file) {
  const texto = await file.text();
  // O arquivo é separado por ponto-e-vírgula. Quebra em linhas, ignora vazias.
  const linhas = texto.split(/\r?\n/).filter((l) => l.trim());
  if (linhas.length < 2) return [];

  // Cabeçalho
  const cabecalho = linhas[0].split(";").map((h) => h.trim());
  const idx = (nome) => cabecalho.findIndex((h) => h.toLowerCase() === nome.toLowerCase());

  const iCodPv         = idx("Cod PagueVeloz");
  const iNsuEmissor    = idx("NSU Emissor");
  const iAutorizacao   = idx("Cod. Autorizacao");
  const iEquipamento   = idx("Equipamento");
  const iPagante       = idx("Pagante");
  const iDataVenda     = idx("Data Venda");
  const iCartao        = idx("Cartao");
  const iBandeira      = idx("Bandeira");
  const iParcelas      = idx("Qtde. Parcelas");
  const iValorBruto    = idx("Valor Bruto");
  const iValorLiquido  = idx("Valor Liquido");
  const iStatus        = idx("Status");

  const vendas = [];
  for (let i = 1; i < linhas.length; i++) {
    const cols = linhas[i].split(";");
    if (cols.length < 5) continue;

    const codPv         = (cols[iCodPv] || "").trim();
    const nsuEmissor    = (cols[iNsuEmissor] || "").trim();
    const autorizacao   = (cols[iAutorizacao] || "").trim().toUpperCase();
    if (!autorizacao) continue;

    const valorBruto    = parseValor(cols[iValorBruto]);
    const valorLiquido  = parseValor(cols[iValorLiquido]);
    const dataVenda     = parseData((cols[iDataVenda] || "").trim());
    const parc          = parseInt(cols[iParcelas] || "0", 10) || 0;
    // Parcelas = 0 na PV significa débito ou crédito à vista (1x).
    // Usamos 1 como base pra identificarTipoOperacao funcionar.
    const qtdParcelas = parc <= 0 ? 1 : parc;
    const status = (cols[iStatus] || "").trim();
    const bandeira = (cols[iBandeira] || "").trim();

    // Detecta débito: PV não tem campo "tipo" como Blu, então olhamos parc=0 como pista
    // mas é mais seguro ler a partir de palavras-chave do plano/cartão se necessário.
    // Por hora, qtdParcelas=0 + bandeiras de débito (MAESTRO, ELO Débito) = débito.
    // Mas o CSV não distingue claro. Mantemos o tipo vazio e deixamos qtdParcelas guiar.
    const tipo = parc <= 0 ? "Débito/À vista" : "Crédito";

    vendas.push({
      // Identificador único: Cod PagueVeloz é único e estável
      nsu: codPv,                                 // ID interno PV (equivalente a codigo_nsu da Blu)
      autorizacao,                                // Cod. Autorizacao = "NSU" pra a Sofá Show
      chaveMatch: normalizarChaveBlu(autorizacao),
      dataVenda,
      bandeira,
      tipo,
      qtdParcelas,
      status: status === "Pago" ? "Confirmada" : status, // Normaliza pra usar mesma flag da Blu
      valorBrutoTotal: isNaN(valorBruto) ? 0 : valorBruto,
      valorLiquidoTotal: isNaN(valorLiquido) ? 0 : valorLiquido,
      parcelasNoExtrato: 1,
      terminal: (cols[iEquipamento] || "").trim(), // PV chama de "Equipamento"
      pagante: (cols[iPagante] || "").trim(),
      cartao: (cols[iCartao] || "").trim(),
      nsuEmissor,                                  // guarda separado, vai pro Excel exportado
    });
  }

  return vendas;
}

// Lê o EXTRATO da Pague Veloz (relatorio-extrato.csv) e devolve só os
// "PIX Recebidos" — que são os PIX que entraram na conta da PV.
// Este arquivo tem estrutura totalmente diferente do relatório de operações:
//   colunas: Id, Data, DataHora, Tipo, TipoInt, TipoEnum, Descricao, Valor
// Ignora todas as outras movimentações (operações de cartão, saques, estornos, etc.).
async function readPagueVelozExtratoPix(file) {
  const texto = await file.text();
  const linhas = texto.split(/\r?\n/).filter((l) => l.trim());
  if (linhas.length < 2) return [];

  const cabecalho = linhas[0].split(";").map((h) => h.trim());
  const idx = (nome) => cabecalho.findIndex((h) => h.toLowerCase() === nome.toLowerCase());

  const iId        = idx("Id");
  const iData      = idx("Data");
  const iTipoEnum  = idx("TipoEnum");
  const iDescricao = idx("Descricao");
  const iValor     = idx("Valor");

  const recebidos = [];
  for (let i = 1; i < linhas.length; i++) {
    const cols = linhas[i].split(";");
    if (cols.length < 5) continue;
    // Filtra: só PIX RECEBIDO
    const tipoEnum = (cols[iTipoEnum] || "").trim();
    if (tipoEnum !== "PixRecebido") continue;

    const id        = (cols[iId] || "").trim();
    const dataStr   = (cols[iData] || "").trim();
    const valorStr  = (cols[iValor] || "").trim();
    const descricao = (cols[iDescricao] || "").trim();

    const dataPix = parseData(dataStr);
    const valor = parseValor(valorStr);
    if (!dataPix || isNaN(valor) || valor <= 0) continue;

    recebidos.push({
      id,
      dataPix,
      valor,
      // Descrição (nome do pagador) é guardada só pra mostrar na UI
      // mas NÃO é usada no matching (conforme pedido)
      pagante: descricao,
    });
  }

  return recebidos;
}

// Conciliação PIX simples: APENAS valor + mês.
// Não usa NSU nem nome do cliente. Se houver vários PIX com mesmo valor
// no mesmo mês, casa o primeiro disponível na ordem.
//
// Retorna { conciliados, soNoErp, soNoExtrato }
//   conciliados: [{ erp, pix }] — vendas que foram pareadas
//   soNoErp:     [{ ...erp, motivoDetalhe }] — vendas no ERP sem PIX correspondente
//   soNoExtrato: [{ ...pix, motivoDetalhe }] — PIX no extrato sem venda correspondente
function conciliarPixPagueVeloz(vendasErp, pixRecebidos, toleranciaValor = 0.01) {
  // Indexa PIX por (ano-mês, valor arredondado em centavos)
  const pixPorChave = new Map();
  for (const p of pixRecebidos) {
    const key = `${p.dataPix.getFullYear()}-${p.dataPix.getMonth()}-${Math.round(p.valor * 100)}`;
    if (!pixPorChave.has(key)) pixPorChave.set(key, []);
    pixPorChave.get(key).push(p);
  }
  // Ordena cada bucket por data — quando há vários PIX com mesmo valor no mês,
  // casamos com a venda mais antiga primeiro
  for (const lista of pixPorChave.values()) {
    lista.sort((a, b) => a.dataPix - b.dataPix);
  }

  const conciliados = [];
  const soNoErp = [];
  const usados = new Set();

  for (const v of vendasErp) {
    if (!v.data) {
      soNoErp.push({ ...v, motivoDetalhe: "ERP sem data válida — não foi possível conciliar." });
      continue;
    }
    const cents = Math.round(v.valor * 100);
    // Tolerância de R$ 0,01: testa o valor exato e os 2 vizinhos em centavos
    const candKeys = [
      `${v.data.getFullYear()}-${v.data.getMonth()}-${cents}`,
      `${v.data.getFullYear()}-${v.data.getMonth()}-${cents - 1}`,
      `${v.data.getFullYear()}-${v.data.getMonth()}-${cents + 1}`,
    ];

    let achou = null;
    for (const k of candKeys) {
      const lista = pixPorChave.get(k);
      if (!lista) continue;
      for (const p of lista) {
        if (usados.has(p.id)) continue;
        if (Math.abs(p.valor - v.valor) > toleranciaValor) continue;
        achou = p;
        usados.add(p.id);
        break;
      }
      if (achou) break;
    }

    if (achou) {
      conciliados.push({ erp: v, pix: achou });
    } else {
      soNoErp.push({
        ...v,
        motivoDetalhe:
          `Não há PIX recebido no extrato da Pague Veloz com valor ${formatarMoeda(v.valor)} ` +
          `dentro do mês ${String(v.data.getMonth() + 1).padStart(2, "0")}/${v.data.getFullYear()}. ` +
          `Verifique se o valor lançado no ERP está correto ou se o PIX foi para outra conta.`,
      });
    }
  }

  // PIX que sobraram no extrato e não foram pareados
  const soNoExtrato = pixRecebidos
    .filter((p) => !usados.has(p.id))
    .map((p) => ({
      ...p,
      motivoDetalhe:
        `Este PIX recebido na Pague Veloz não tem venda correspondente no ERP em ` +
        `${String(p.dataPix.getMonth() + 1).padStart(2, "0")}/${p.dataPix.getFullYear()} ` +
        `com valor ${formatarMoeda(p.valor)}. Pode ser PIX VELOZ VPP ou PIX VELOZ SS ` +
        `(não Express), ou venda esquecida no sistema.`,
    }));

  return { conciliados, soNoErp, soNoExtrato };
}

// Lê o PDF do ERP (Vendas Por Finalizadores) e extrai vendas de uma seção
// específica (BLU SS EXPRESS ou BLU LUPE).
async function readErpBluPdf(file, secaoNome) {
  if (!window.pdfjsLib) await loadPdfJs();
  const data = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data }).promise;
  let texto = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const linhas = {};
    for (const item of content.items) {
      const y = Math.round(item.transform[5]);
      if (!linhas[y]) linhas[y] = [];
      linhas[y].push({ x: item.transform[4], str: item.str });
    }
    const ys = Object.keys(linhas).sort((a, b) => b - a);
    for (const y of ys) {
      linhas[y].sort((a, b) => a.x - b.x);
      texto += linhas[y].map((i) => i.str).join(" ") + "\n";
    }
  }

  return parseErpBluTexto(texto, secaoNome);
}

// Extrai vendas de uma seção do PDF do ERP.
// Cada linha: "4 02/03/2026 6544 78454 (068982) MAGALI...  3,500.00 MASTER CRÉDITO/302427/1"
//
// Tolerante a variações que o pdf.js produz: espaços múltiplos, quebras de linha
// no meio, e seção com nome ligeiramente diferente.
function parseErpBluTexto(texto, secaoNome) {
  // 1. Tenta achar o início da seção com regex flexível (espaços/quebras tolerados)
  // Escapa o nome da seção para usar em regex e troca espaços por \s+
  const secaoEscapada = secaoNome
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  const reInicio = new RegExp(`Forma\\s+de\\s+Pagamento\\s*:\\s*${secaoEscapada}`, "i");
  const reFim = new RegExp(`Total\\s*:\\s*${secaoEscapada}`, "i");

  const matchInicio = texto.match(reInicio);
  let secao;
  if (matchInicio) {
    const inicio = matchInicio.index + matchInicio[0].length;
    const restante = texto.slice(inicio);
    const matchFim = restante.match(reFim);
    secao = matchFim ? restante.slice(0, matchFim.index) : restante;
  } else {
    // Fallback: se não encontrou a seção, vai escanear o texto inteiro
    // (o filtro por palavra-chave acontece linha a linha mais abaixo)
    secao = texto;
  }

  // 2. Quebra em linhas e tenta extrair venda de cada uma
  // O pdf.js às vezes embaralha linhas longas, então tratamos cada bloco separadamente
  const vendas = [];
  // O pdf.js às vezes une o valor com a rede sem espaço (ex: "2,108.00MASTER CREDITO/...")
  // e às vezes com espaço. Por isso usamos \s* (zero ou mais) entre valor e rede.
  // O valor termina sempre com 2 decimais (\.\d{2}), o que serve de âncora segura.
  const reLinhaVenda = /(\d+)\s+(\d{2}\/\d{2}\/\d{4})\s+(\d+)\s+(\d+)\s+\((\d+)\)\s*([^\n\r]+?)\s+([\d.,]+\.\d{2})\s*([A-ZÀ-Ÿa-zà-ÿ][A-ZÀ-Ÿa-zà-ÿ\s]*?)\/([^/\s]+)\/(\d+)/g;

  let m;
  while ((m = reLinhaVenda.exec(secao)) !== null) {
    const [, loja, data, numVenda, numPedido, codCliente, cliente, valor, rede, nsuErp, parcelasErp] = m;
    const dataObj = parseData(data);

    // Filtro extra de segurança no fallback: se não achou a seção,
    // verifica se a linha tem palavra-chave da seção alvo (evita pegar venda de outra forma)
    if (!matchInicio) {
      // Linha completa pra contexto: achar a linha original que contém esse match
      const linhaCompleta = m[0];
      // Esse match não tem como nos dizer se é da seção certa, então no fallback,
      // pegamos só linhas onde "BLU" aparece no campo "rede" (último campo)
      if (!/BLU/i.test(rede) && !/BLU/i.test(linhaCompleta)) {
        continue;
      }
    }

    vendas.push({
      origem: "erp_blu",
      loja: loja.trim(),
      data: dataObj,
      dataStr: data,
      numVenda: numVenda.trim(),
      numPedido: numPedido.trim(),
      codCliente: codCliente.trim(),
      cliente: cliente.trim(),
      valor: parseValor(valor),
      rede: rede.trim(),
      nsuErp: nsuErp.trim().toUpperCase(),
      chaveMatch: normalizarChaveBlu(nsuErp),
      parcelasErp: parseInt(parcelasErp),
    });
  }

  // 3. Log de debug pra console do navegador (F12 → Console)
  if (typeof console !== "undefined") {
    console.log(`[BLU] Procurando seção "${secaoNome}":`, {
      secaoEncontrada: !!matchInicio,
      tamanhoSecao: secao.length,
      vendasExtraidas: vendas.length,
      primeira: vendas[0]?.cliente?.substring(0, 30),
      ultima: vendas[vendas.length - 1]?.cliente?.substring(0, 30),
    });
  }

  return vendas;
}

// Matcher Blu/PV: chave (NSU normalizado) + mesmo mês/ano + valor com tolerância R$ 0,01
// Se receber `tabelaTaxas`, também confere a taxa cobrada vs negociada em cada venda conciliada.
// `tipoMaquininha` define qual conferidor usar: "blu" (default) ou "pague_veloz".
function conciliarBlu(vendasBlu, vendasErp, toleranciaValor = 0.01, tabelaTaxas = null, tipoMaquininha = "blu") {
  // Indexa Blu por chave de match (NSU normalizado)
  const bluPorChave = new Map();
  for (const v of vendasBlu) {
    if (!bluPorChave.has(v.chaveMatch)) bluPorChave.set(v.chaveMatch, []);
    bluPorChave.get(v.chaveMatch).push(v);
  }

  // Escolhe o conferidor de taxa apropriado
  const conferirTaxa = tipoMaquininha === "pague_veloz" ? conferirTaxaVendaPV : conferirTaxaVenda;

  // Nome amigável da maquininha pra usar nas mensagens de motivo
  const nomeMaquininha = tipoMaquininha === "pague_veloz" ? "Pague Veloz" : "Blu";

  // Helper: mesmo mês entre 2 datas
  const mesmoMes = (d1, d2) =>
    d1 && d2 &&
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth();

  // Helper: formata "MM/YYYY"
  const formatMesAno = (d) =>
    d ? `${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}` : "?";

  const conciliados = [];
  const soNoErp = [];   // cada item: { ...vErp, motivo, motivoDetalhe, candidatoBlu? }
  const soNaBlu = [];   // cada item: { ...vBlu, motivo, motivoDetalhe, candidatoErp? }
  const taxasForaNegociada = []; // cada item: { erp, blu, conferencia }
  const bluMatched = new Set();
  // Guarda quais NSUs da Blu foram "explicados" como divergência de valor/mês/NSU
  // (pra não duplicar do lado da Blu)
  const bluExplicado = new Map(); // nsu -> { motivo, candidatoErp }

  // === LADO ERP: classifica cada venda do ERP ===
  for (const vErp of vendasErp) {
    const candidatos = bluPorChave.get(vErp.chaveMatch) || [];
    let conciliado = null;

    // Tenta match perfeito (mês + valor)
    for (const cand of candidatos) {
      if (bluMatched.has(cand.nsu)) continue;
      const valorBate = Math.abs(cand.valorBrutoTotal - vErp.valor) <= toleranciaValor;
      if (mesmoMes(vErp.data, cand.dataVenda) && valorBate) {
        conciliado = cand;
        break;
      }
    }

    if (conciliado) {
      // Confere a taxa contra a tabela negociada (se foi fornecida)
      let conferencia = null;
      if (tabelaTaxas) {
        conferencia = conferirTaxa(conciliado, tabelaTaxas);
        // Só "acima" entra na lista de fora da negociada
        if (conferencia.status === "acima") {
          taxasForaNegociada.push({ erp: vErp, blu: conciliado, conferencia });
        }
      }
      conciliados.push({ erp: vErp, blu: conciliado, conferencia });
      bluMatched.add(conciliado.nsu);
      continue;
    }

    // Não conciliou — descobre o motivo
    if (candidatos.length === 0) {
      // 🟠 Nova checagem: o NSU não bate com a Blu, mas talvez exista uma venda
      // com mesmo VALOR + mesmo MÊS (NSU divergente — provável erro de digitação).
      // Procura entre todas as vendas Confirmadas da Blu ainda não usadas.
      let candNsuDivergente = null;
      for (const v of vendasBlu) {
        if (v.status !== "Confirmada") continue;
        if (bluMatched.has(v.nsu)) continue;
        if (bluExplicado.has(v.nsu)) continue;
        const valorBate = Math.abs(v.valorBrutoTotal - vErp.valor) <= toleranciaValor;
        if (valorBate && mesmoMes(vErp.data, v.dataVenda)) {
          candNsuDivergente = v;
          break;
        }
      }

      if (candNsuDivergente) {
        // 🟣 NSU divergente: mesmo valor e mês, mas NSU diferente entre ERP e o extrato
        const motivoDetalhe =
          `NSU divergente entre os dois arquivos: ERP registra "${vErp.nsuErp}" e ${nomeMaquininha} registra "${candNsuDivergente.autorizacao}". ` +
          `Os dois lançamentos têm mesmo valor (${formatarMoeda(vErp.valor)}) e mesmo mês (${formatMesAno(vErp.data)}), ` +
          `provável erro de digitação em um dos lados.`;
        soNoErp.push({
          ...vErp,
          motivo: "nsu_divergente",
          motivoDetalhe,
          candidatoBlu: candNsuDivergente,
        });
        bluExplicado.set(candNsuDivergente.nsu, { motivo: "nsu_divergente", candidatoErp: vErp });
        continue;
      }

      // 🟠 O NSU do ERP não existe no extrato da maquininha (e não tem nada com mesmo valor/mês)
      // Pode ser que essa venda tenha sido passada em outra maquininha
      const nomeMaquininha = tipoMaquininha === "pague_veloz" ? "Pague Veloz" : "Blu";
      soNoErp.push({
        ...vErp,
        motivo: "sem_nsu",
        motivoDetalhe:
          `O NSU "${vErp.nsuErp}" não foi encontrado no extrato da ${nomeMaquininha}. ` +
          `Esta venda pode ter sido passada em outra maquininha (Blu, Pague Veloz, PIX, etc.) ` +
          `ou foi lançada na seção errada do ERP.`,
      });
      continue;
    }

    // Tem candidatos com mesmo NSU → procura o "melhor candidato" entre os disponíveis
    // Prioridade: mesmo mês + valor diferente > mês diferente + valor igual > qualquer
    let melhorCand = null;
    let motivo = null;
    let motivoDetalhe = "";

    for (const cand of candidatos) {
      if (bluMatched.has(cand.nsu)) continue;
      const valorBate = Math.abs(cand.valorBrutoTotal - vErp.valor) <= toleranciaValor;
      const mm = mesmoMes(vErp.data, cand.dataVenda);

      if (mm && !valorBate) {
        // 🔴 mesmo mês, valor diferente → vence outras hipóteses
        const diff = (cand.valorBrutoTotal - vErp.valor);
        const diffStr = formatarMoeda(Math.abs(diff));
        const sinal = diff > 0 ? `${nomeMaquininha} maior` : "ERP maior";
        melhorCand = cand;
        motivo = "valor_diferente";
        motivoDetalhe = `Valor diferente: ERP ${formatarMoeda(vErp.valor)} | ${nomeMaquininha} ${formatarMoeda(cand.valorBrutoTotal)} (diferença ${diffStr}, ${sinal}).`;
        break;
      }
      if (!mm && valorBate && !melhorCand) {
        // 🟡 valor igual, mês diferente
        melhorCand = cand;
        motivo = "mes_diferente";
        motivoDetalhe = `Mês diferente: ERP ${formatMesAno(vErp.data)} | ${nomeMaquininha} ${formatMesAno(cand.dataVenda)} (mesmo valor e NSU).`;
      }
    }

    if (!melhorCand) {
      // Há candidatos mas todos já foram usados, ou nenhum bate parcialmente
      const cand = candidatos.find((c) => !bluMatched.has(c.nsu)) || candidatos[0];
      melhorCand = cand;
      motivo = "valor_e_mes_diferentes";
      motivoDetalhe = `NSU bate, mas valor e mês são diferentes: ERP ${formatarMoeda(vErp.valor)} em ${formatMesAno(vErp.data)} | ${nomeMaquininha} ${formatarMoeda(cand.valorBrutoTotal)} em ${formatMesAno(cand.dataVenda)}.`;
    }

    soNoErp.push({ ...vErp, motivo, motivoDetalhe, candidatoBlu: melhorCand });
    // Marca esse NSU da Blu como "já explicado" pra não duplicar
    if (melhorCand) {
      bluExplicado.set(melhorCand.nsu, { motivo, candidatoErp: vErp });
    }
  }

  // === LADO BLU: vendas da Blu que não foram conciliadas ===
  for (const vBlu of vendasBlu) {
    if (vBlu.status !== "Confirmada") continue;       // canceladas vão pra outra lista
    if (bluMatched.has(vBlu.nsu)) continue;           // já conciliada

    // Se já foi "explicada" do lado do ERP (apareceu como divergência), espelha aqui
    const explicado = bluExplicado.get(vBlu.nsu);
    if (explicado) {
      const candidatoErp = explicado.candidatoErp;
      let motivo = explicado.motivo;
      let motivoDetalhe = "";
      if (motivo === "valor_diferente") {
        const diff = (vBlu.valorBrutoTotal - candidatoErp.valor);
        const diffStr = formatarMoeda(Math.abs(diff));
        const sinal = diff > 0 ? `${nomeMaquininha} maior` : "ERP maior";
        motivoDetalhe = `Valor diferente: ${nomeMaquininha} ${formatarMoeda(vBlu.valorBrutoTotal)} | ERP ${formatarMoeda(candidatoErp.valor)} (diferença ${diffStr}, ${sinal}).`;
      } else if (motivo === "mes_diferente") {
        motivoDetalhe = `Mês diferente: ${nomeMaquininha} ${formatMesAno(vBlu.dataVenda)} | ERP ${formatMesAno(candidatoErp.data)} (mesmo valor e NSU).`;
      } else if (motivo === "nsu_divergente") {
        motivoDetalhe =
          `NSU divergente entre os dois arquivos: ${nomeMaquininha} registra "${vBlu.autorizacao}" e ERP registra "${candidatoErp.nsuErp}". ` +
          `Os dois lançamentos têm mesmo valor (${formatarMoeda(vBlu.valorBrutoTotal)}) e mesmo mês (${formatMesAno(vBlu.dataVenda)}), ` +
          `provável erro de digitação em um dos lados.`;
      } else {
        motivoDetalhe = `NSU bate, mas valor e mês são diferentes: ${nomeMaquininha} ${formatarMoeda(vBlu.valorBrutoTotal)} em ${formatMesAno(vBlu.dataVenda)} | ERP ${formatarMoeda(candidatoErp.valor)} em ${formatMesAno(candidatoErp.data)}.`;
      }
      soNaBlu.push({ ...vBlu, motivo, motivoDetalhe, candidatoErp });
      continue;
    }

    // Sem candidato no ERP — venda 100% só no extrato da maquininha
    soNaBlu.push({
      ...vBlu,
      motivo: "sem_no_erp",
      motivoDetalhe: `Esta venda não tem correspondente no PDF do ERP (pode ser teste, venda esquecida no sistema ou divergência de cadastro).`,
    });
  }

  const canceladas = vendasBlu.filter((v) => v.status !== "Confirmada");

  return { conciliados, soNoErp, soNaBlu, canceladas, taxasForaNegociada };
}

// ============================================================
// CONCILIAÇÃO
// ============================================================

function conciliar(sifatItems, pedidoItems, colorTable = []) {
  const esquecidos = [];
  const cobertos = [];
  const pedidosUsados = new Set(); // rastreia quais pedidos casaram com algum negativo

  for (const s of sifatItems) {
    const matches = pedidoItems.filter((p) => itemsMatch(s, p, colorTable));
    const qtdPedida = matches.reduce((sum, p) => sum + (p.quantidade || 0), 0);

    // Marca os pedidos que casaram com esse negativo
    matches.forEach((p) => pedidosUsados.add(p));

    if (qtdPedida >= s.quantidadeNegativa) {
      cobertos.push({ sifat: s, pedidos: matches, qtdPedida });
    } else {
      esquecidos.push({
        sifat: s,
        pedidos: matches,
        qtdPedida,
        faltam: s.quantidadeNegativa - qtdPedida,
      });
    }
  }

  // Pedidos que NÃO casaram com nenhum negativo do SIFAT
  // (loja fez encomenda mas o produto não está negativo no estoque)
  const semNegativo = pedidoItems.filter((p) => !pedidosUsados.has(p));

  return { esquecidos, cobertos, semNegativo };
}

// ============================================================
// HOOK: Tabela de Cores (persistência no Supabase)
// ============================================================
//
// MUDANÇA DA ETAPA B: Antes salvava no localStorage do navegador,
// agora lê e escreve direto na tabela "cores" do Supabase pra
// que todos os usuários logados vejam os mesmos dados.
//
// Estratégia ao salvar: estratégia "replace all" — apaga todas as cores
// e insere de novo. É simples, confiável e a tabela tem poucas linhas.
//
// Permissões: ler é livre pra qualquer usuário logado. Escrever exige
// perm_cores='editar' ou is_admin=true (controlado pelo RLS no Supabase).
// ============================================================

function useColorTable() {
  const [table, setTable] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);

  // Função de carregamento (extraída pra poder ser chamada também via reload())
  const carregar = useCallback(async () => {
    try {
      console.log("[Cores] Carregando do Supabase...");
      const { data, error: err } = await supabase
        .from("cores")
        .select("codigo, nome")
        .order("codigo", { ascending: true });

      if (err) {
        console.error("[Cores] Erro ao carregar:", err);
        setError("Erro ao carregar cores do servidor: " + err.message);
        // Em caso de erro, usa o padrão local pra não bloquear o uso do app
        setTable(DEFAULT_COLOR_TABLE);
      } else if (data && data.length > 0) {
        console.log(`[Cores] Carregadas ${data.length} cores do Supabase`);
        setTable(data.map((c) => ({ codigo: c.codigo, nome: c.nome })));
        setError(null);
      } else {
        // Tabela vazia no Supabase — usa padrão local (não tenta inserir
        // pra não dar erro se o usuário não tiver permissão de escrita)
        console.log("[Cores] Tabela 'cores' vazia no Supabase, exibindo padrão");
        setTable(DEFAULT_COLOR_TABLE);
        setError(null);
      }
    } catch (e) {
      console.error("[Cores] Erro inesperado:", e);
      setError("Erro inesperado ao carregar cores: " + e.message);
      setTable(DEFAULT_COLOR_TABLE);
    } finally {
      setLoaded(true);
    }
  }, []);

  // Carrega ao montar
  useEffect(() => {
    carregar();
  }, [carregar]);

  // Recarrega manualmente (usado quando o usuário entra na tela)
  const reload = useCallback(() => {
    console.log("[Cores] Recarregando manualmente...");
    return carregar();
  }, [carregar]);

  // Salva a tabela inteira no Supabase usando estratégia "replace all":
  // 1. Apaga todas as linhas existentes
  // 2. Insere as novas linhas
  // Retorna true se deu certo, false se falhou.
  // Em caso de falha de permissão (RLS), seta uma mensagem clara em error.
  const save = useCallback(async (newTable) => {
    console.log(`[Cores] Salvando ${newTable.length} cores no Supabase...`);
    setError(null);

    try {
      // 1. Apaga tudo. O .neq('codigo', '__nunca__') é um truque pra "deletar todas
      // as linhas" — o Supabase exige um filtro em delete pra evitar acidentes.
      const { error: errDel } = await supabase
        .from("cores")
        .delete()
        .neq("codigo", "__nunca_existira_essa_string__");

      if (errDel) {
        console.error("[Cores] Erro no delete:", errDel);
        // Detecta erro de permissão por mensagem ou status
        if (errDel.message?.includes("policy") || errDel.code === "42501") {
          setError("Sem permissão para editar a tabela de cores. Peça para o administrador liberar a permissão 'Cores' pra você.");
        } else {
          setError("Erro ao salvar cores: " + errDel.message);
        }
        return false;
      }

      // 2. Insere as novas linhas (se houver)
      if (newTable.length > 0) {
        const linhasParaInserir = newTable.map((c) => ({
          codigo: c.codigo,
          nome: c.nome,
        }));

        const { error: errIns } = await supabase
          .from("cores")
          .insert(linhasParaInserir);

        if (errIns) {
          console.error("[Cores] Erro no insert:", errIns);
          if (errIns.message?.includes("policy") || errIns.code === "42501") {
            setError("Sem permissão para editar a tabela de cores. Peça para o administrador liberar a permissão 'Cores' pra você.");
          } else if (errIns.code === "23505") {
            setError("Erro ao salvar: existem códigos de cor duplicados.");
          } else {
            setError("Erro ao salvar cores: " + errIns.message);
          }
          return false;
        }
      }

      // 3. Atualiza o estado local depois do sucesso
      setTable(newTable);
      console.log(`[Cores] Salvo com sucesso. ${newTable.length} cores no Supabase.`);
      return true;
    } catch (e) {
      console.error("[Cores] Erro inesperado ao salvar:", e);
      setError("Erro inesperado ao salvar: " + e.message);
      return false;
    }
  }, []);

  return { table, save, loaded, error, reload };
}

// ============================================================
// HOOK: Tabela de Taxas Blu (persistência no Supabase)
// ============================================================
//
// MUDANÇA DA ETAPA B: lê e escreve na tabela "taxas_blu" do Supabase.
// A tabela tem estrutura simples: uma única linha (id=1) com um campo
// JSONB chamado "taxas" que guarda o objeto inteiro.
//
// Permissões: ler é livre pra qualquer usuário logado. Escrever exige
// perm_taxas='editar' ou is_admin=true (controlado pelo RLS no Supabase).
// ============================================================

function useTaxasBlu() {
  const [taxas, setTaxas] = useState(DEFAULT_TAXAS_BLU);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);

  const carregar = useCallback(async () => {
    try {
      console.log("[TaxasBlu] Carregando do Supabase...");
      const { data, error: err } = await supabase
        .from("taxas_blu")
        .select("taxas")
        .eq("id", 1)
        .single();

      if (err) {
        console.error("[TaxasBlu] Erro ao carregar:", err);
        // PGRST116 = "no rows" (linha não existe ainda)
        if (err.code === "PGRST116") {
          console.log("[TaxasBlu] Linha id=1 não existe ainda — usando padrão");
          setTaxas(DEFAULT_TAXAS_BLU);
          setError(null);
        } else {
          setError("Erro ao carregar taxas Blu do servidor: " + err.message);
          setTaxas(DEFAULT_TAXAS_BLU);
        }
      } else if (data?.taxas) {
        // Mescla com defaults pra garantir que toda chave esteja presente
        const merged = { ...DEFAULT_TAXAS_BLU };
        for (const tipo of Object.keys(DEFAULT_TAXAS_BLU)) {
          merged[tipo] = { ...DEFAULT_TAXAS_BLU[tipo], ...(data.taxas?.[tipo] || {}) };
        }
        console.log("[TaxasBlu] Carregadas do Supabase");
        setTaxas(merged);
        setError(null);
      } else {
        console.log("[TaxasBlu] Linha existe mas campo 'taxas' está vazio — usando padrão");
        setTaxas(DEFAULT_TAXAS_BLU);
        setError(null);
      }
    } catch (e) {
      console.error("[TaxasBlu] Erro inesperado:", e);
      setError("Erro inesperado ao carregar taxas Blu: " + e.message);
      setTaxas(DEFAULT_TAXAS_BLU);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const reload = useCallback(() => {
    console.log("[TaxasBlu] Recarregando manualmente...");
    return carregar();
  }, [carregar]);

  const save = useCallback(async (novas) => {
    console.log("[TaxasBlu] Salvando no Supabase...");
    setError(null);

    try {
      // Usamos UPDATE em id=1 (a linha já foi pré-criada pelo SQL inicial).
      // Se não existir ainda, o update vai retornar 0 linhas afetadas mas
      // sem erro — nesse caso fazemos um upsert pra criar.
      const { error: errUpd, data } = await supabase
        .from("taxas_blu")
        .update({ taxas: novas, updated_at: new Date().toISOString() })
        .eq("id", 1)
        .select();

      if (errUpd) {
        console.error("[TaxasBlu] Erro no update:", errUpd);
        if (errUpd.message?.includes("policy") || errUpd.code === "42501") {
          setError("Sem permissão para editar as taxas. Peça para o administrador liberar a permissão 'Taxas' pra você.");
        } else {
          setError("Erro ao salvar taxas Blu: " + errUpd.message);
        }
        return false;
      }

      // Se nenhuma linha foi atualizada, faz upsert (insere a linha id=1)
      if (!data || data.length === 0) {
        const { error: errIns } = await supabase
          .from("taxas_blu")
          .upsert({ id: 1, taxas: novas, updated_at: new Date().toISOString() });

        if (errIns) {
          console.error("[TaxasBlu] Erro no upsert:", errIns);
          if (errIns.message?.includes("policy") || errIns.code === "42501") {
            setError("Sem permissão para editar as taxas. Peça para o administrador liberar a permissão 'Taxas' pra você.");
          } else {
            setError("Erro ao salvar taxas Blu: " + errIns.message);
          }
          return false;
        }
      }

      setTaxas(novas);
      console.log("[TaxasBlu] Salvo com sucesso");
      return true;
    } catch (e) {
      console.error("[TaxasBlu] Erro inesperado ao salvar:", e);
      setError("Erro inesperado ao salvar taxas Blu: " + e.message);
      return false;
    }
  }, []);

  return { taxas, save, loaded, error, reload };
}

// ============================================================
// HOOK: Tabela de Taxas Pague Veloz (persistência no Supabase)
// ============================================================
//
// MUDANÇA DA ETAPA B: idêntico ao useTaxasBlu mas usa a tabela
// "taxas_pague_veloz" (estrutura também é id=1, taxas JSONB).
// ============================================================

function useTaxasPagueVeloz() {
  const [taxas, setTaxas] = useState(DEFAULT_TAXAS_PV);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);

  const carregar = useCallback(async () => {
    try {
      console.log("[TaxasPV] Carregando do Supabase...");
      const { data, error: err } = await supabase
        .from("taxas_pague_veloz")
        .select("taxas")
        .eq("id", 1)
        .single();

      if (err) {
        console.error("[TaxasPV] Erro ao carregar:", err);
        if (err.code === "PGRST116") {
          console.log("[TaxasPV] Linha id=1 não existe ainda — usando padrão");
          setTaxas(DEFAULT_TAXAS_PV);
          setError(null);
        } else {
          setError("Erro ao carregar taxas Pague Veloz do servidor: " + err.message);
          setTaxas(DEFAULT_TAXAS_PV);
        }
      } else if (data?.taxas) {
        const merged = { ...DEFAULT_TAXAS_PV, ...(data.taxas || {}) };
        console.log("[TaxasPV] Carregadas do Supabase");
        setTaxas(merged);
        setError(null);
      } else {
        console.log("[TaxasPV] Linha existe mas campo 'taxas' está vazio — usando padrão");
        setTaxas(DEFAULT_TAXAS_PV);
        setError(null);
      }
    } catch (e) {
      console.error("[TaxasPV] Erro inesperado:", e);
      setError("Erro inesperado ao carregar taxas Pague Veloz: " + e.message);
      setTaxas(DEFAULT_TAXAS_PV);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const reload = useCallback(() => {
    console.log("[TaxasPV] Recarregando manualmente...");
    return carregar();
  }, [carregar]);

  const save = useCallback(async (novas) => {
    console.log("[TaxasPV] Salvando no Supabase...");
    setError(null);

    try {
      const { error: errUpd, data } = await supabase
        .from("taxas_pague_veloz")
        .update({ taxas: novas, updated_at: new Date().toISOString() })
        .eq("id", 1)
        .select();

      if (errUpd) {
        console.error("[TaxasPV] Erro no update:", errUpd);
        if (errUpd.message?.includes("policy") || errUpd.code === "42501") {
          setError("Sem permissão para editar as taxas. Peça para o administrador liberar a permissão 'Taxas' pra você.");
        } else {
          setError("Erro ao salvar taxas Pague Veloz: " + errUpd.message);
        }
        return false;
      }

      if (!data || data.length === 0) {
        const { error: errIns } = await supabase
          .from("taxas_pague_veloz")
          .upsert({ id: 1, taxas: novas, updated_at: new Date().toISOString() });

        if (errIns) {
          console.error("[TaxasPV] Erro no upsert:", errIns);
          if (errIns.message?.includes("policy") || errIns.code === "42501") {
            setError("Sem permissão para editar as taxas. Peça para o administrador liberar a permissão 'Taxas' pra você.");
          } else {
            setError("Erro ao salvar taxas Pague Veloz: " + errIns.message);
          }
          return false;
        }
      }

      setTaxas(novas);
      console.log("[TaxasPV] Salvo com sucesso");
      return true;
    } catch (e) {
      console.error("[TaxasPV] Erro inesperado ao salvar:", e);
      setError("Erro inesperado ao salvar taxas Pague Veloz: " + e.message);
      return false;
    }
  }, []);

  return { taxas, save, loaded, error, reload };
}

// ============================================================
// HOOK: Contexto do usuário (grupo + lojas + permissões)
// ============================================================
//
// ETAPA C: Carrega informações do usuário logado:
//   • É admin? (campo is_admin em user_permissions)
//   • Em qual grupo está? (tabela usuarios_grupos)
//   • Em quais lojas tem acesso? (tabela usuarios_lojas)
//   • Tem acesso ao Escritório? (uma das lojas dele tem eh_escritorio=true)
//
// Tudo isso é usado pra decidir o que mostrar pro usuário no menu e
// quais botões habilitar/bloquear nos módulos.
// ============================================================

function useUserContext(user) {
  const [ctx, setCtx] = useState({
    loading: true,
    isAdmin: false,
    isRH: false,           // ETAPA C+: é admin do RH?
    grupoId: null,
    grupoNome: null,
    permissoes: { conciliacao: "sem_acesso", cores: "sem_acesso", taxas: "sem_acesso", financeiro: "sem_acesso" },
    lojas: [],            // [{ id, nome, eh_escritorio }, ...]
    estaNoEscritorio: false,
    error: null,
  });

  const carregar = useCallback(async () => {
    if (!user) {
      setCtx((c) => ({ ...c, loading: false }));
      return;
    }
    try {
      // 1) Verifica se é admin e/ou RH
      const { data: permRow } = await supabase
        .from("user_permissions")
        .select("is_admin, eh_rh")
        .eq("user_id", user.id)
        .maybeSingle();
      const isAdmin = !!permRow?.is_admin;
      const isRH    = !!permRow?.eh_rh;

      // 2) Busca grupo do usuário (se houver)
      const { data: grupoRow } = await supabase
        .from("usuarios_grupos")
        .select("grupo_id, grupos ( id, nome, permissoes )")
        .eq("user_id", user.id)
        .maybeSingle();

      const grupoId = grupoRow?.grupos?.id || null;
      const grupoNome = grupoRow?.grupos?.nome || null;
      const permissoesGrupo = grupoRow?.grupos?.permissoes || {};

      // Permissões finais: admin sempre vê tudo; senão, usa as do grupo
      const permissoes = isAdmin
        ? { conciliacao: "editar", cores: "editar", taxas: "editar", financeiro: "editar" }
        : {
            conciliacao: permissoesGrupo.conciliacao || "sem_acesso",
            cores:       permissoesGrupo.cores       || "sem_acesso",
            taxas:       permissoesGrupo.taxas       || "sem_acesso",
            financeiro:  permissoesGrupo.financeiro  || "sem_acesso",
          };

      // 3) Busca lojas do usuário
      // Admin: vê todas as lojas ativas. Senão: só as cadastradas
      let lojas = [];
      if (isAdmin) {
        const { data } = await supabase
          .from("lojas")
          .select("id, nome, eh_escritorio")
          .eq("ativa", true)
          .order("nome");
        lojas = data || [];
      } else {
        const { data } = await supabase
          .from("usuarios_lojas")
          .select("loja_id, lojas ( id, nome, eh_escritorio, ativa )")
          .eq("user_id", user.id);
        lojas = (data || [])
          .map((r) => r.lojas)
          .filter((l) => l && l.ativa)
          .map((l) => ({ id: l.id, nome: l.nome, eh_escritorio: l.eh_escritorio }))
          .sort((a, b) => a.nome.localeCompare(b.nome));
      }

      const estaNoEscritorio = isAdmin || lojas.some((l) => l.eh_escritorio);

      setCtx({
        loading: false,
        isAdmin,
        isRH,
        grupoId,
        grupoNome,
        permissoes,
        lojas,
        estaNoEscritorio,
        error: null,
      });

      console.log("[UserContext] Carregado:", {
        email: user.email,
        isAdmin,
        isRH,
        grupoNome,
        permissoes,
        lojas: lojas.map((l) => l.nome),
        estaNoEscritorio,
      });
    } catch (e) {
      console.error("[UserContext] Erro:", e);
      setCtx((c) => ({ ...c, loading: false, error: e.message }));
    }
  }, [user]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const reload = useCallback(() => carregar(), [carregar]);

  return { ...ctx, reload };
}

// Helpers pra interpretar permissões
function podeVerModulo(permissoes, modulo) {
  return permissoes?.[modulo] === "visualizar" || permissoes?.[modulo] === "editar";
}

function podeEditarModulo(permissoes, modulo) {
  return permissoes?.[modulo] === "editar";
}


// Converte a URL hash em { module, bancoId } e vice-versa.
// Formato: #/<module>[/<bancoId>]
// Exemplos:
//   #/                                  → módulo conciliacao (default)
//   #/cores                              → módulo cores
//   #/financeiro                         → módulo financeiro (tela de seleção)
//   #/financeiro/pague_veloz_express     → financeiro com banco pré-selecionado
//   #/taxas                              → tabelas de taxas
// ============================================================

const ROTAS_VALIDAS = ["home", "conciliacao", "cores", "financeiro", "taxas", "permissoes", "pedido_venda", "estoque", "relatorios", "config"];
const BANCOS_VALIDOS = ["sicredi", "blu_ss", "blu_lupe", "pague_veloz_express", "pague_veloz_pix"];

function parseHashRoute(hash) {
  // Remove o "#" e barras iniciais
  const limpo = (hash || "").replace(/^#\/?/, "").trim();
  if (!limpo) return { module: "home", bancoId: null };

  const partes = limpo.split("/").filter(Boolean);
  const module = ROTAS_VALIDAS.includes(partes[0]) ? partes[0] : "home";
  const bancoId = (module === "financeiro" && BANCOS_VALIDOS.includes(partes[1])) ? partes[1] : null;
  return { module, bancoId };
}

function buildHashRoute(module, bancoId) {
  if (!module || module === "home") {
    return `#/`;
  }
  if (module === "conciliacao") {
    return bancoId ? `#/conciliacao` : `#/conciliacao`;
  }
  if (module === "financeiro" && bancoId) {
    return `#/financeiro/${bancoId}`;
  }
  return `#/${module}`;
}

// Hook que sincroniza a URL hash com o estado de navegação do app.
// Retorna { module, bancoId, navigate(module, bancoId) }
function useHashRoute() {
  const [route, setRoute] = useState(() => parseHashRoute(window.location.hash));

  useEffect(() => {
    const onHashChange = () => {
      setRoute(parseHashRoute(window.location.hash));
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const navigate = useCallback((module, bancoId = null) => {
    const novoHash = buildHashRoute(module, bancoId);
    // Se já estamos nessa rota, não faz nada (evita loop)
    if (window.location.hash === novoHash || (window.location.hash === "" && novoHash === "#/")) {
      // Só atualiza o estado interno se necessário
      const atual = parseHashRoute(window.location.hash);
      if (atual.module !== module || atual.bancoId !== bancoId) {
        setRoute({ module, bancoId });
      }
      return;
    }
    window.location.hash = novoHash;
    // O hashchange listener vai disparar e atualizar o estado
  }, []);

  return { module: route.module, bancoId: route.bancoId, navigate };
}

// ============================================================
// HOOK DE AUTENTICAÇÃO
// Gerencia a sessão do usuário no Supabase.
// Retorna { user, loading, logout }:
//   user    — objeto do usuário logado (ou null se não estiver logado)
//   loading — true enquanto carrega a sessão inicial
//   logout  — função pra fazer logout
// ============================================================

function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    // Pega a sessão atual (se já estiver logado de antes)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      setUser(session?.user || null);
      setLoading(false);
    }).catch((e) => {
      console.error("Erro ao obter sessão:", e);
      if (!cancelled) setLoading(false);
    });

    // Escuta mudanças de sessão (login, logout, refresh do token)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      setUser(session?.user || null);
    });

    return () => {
      cancelled = true;
      subscription?.unsubscribe();
    };
  }, []);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    // O onAuthStateChange já vai zerar o user automaticamente
  }, []);

  return { user, loading, logout };
}

// ============================================================
// UI COMPONENTS
// ============================================================

// Painel reutilizável que mostra como tirar o relatório "Vendas Por Finalizadores"
// do ERP. Usado em todas as telas de conciliação (Blu, PV Express, PV PIX).
function ComoTirarRelatorioErp() {
  return (
    <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-6">
      <div className="flex items-start gap-3 mb-3">
        <AlertCircle className="w-5 h-5 text-orange-700 mt-0.5 flex-shrink-0" />
        <div>
          <h3 className="font-serif text-base font-semibold text-orange-900">
            Como tirar o PDF do ERP (Vendas Por Finalizadores)
          </h3>
          <p className="text-xs text-orange-800 mt-0.5">
            Siga os passos abaixo para gerar o relatório no SIFAT.
          </p>
        </div>
      </div>

      <ol className="space-y-2.5 text-sm text-orange-900 ml-1">
        <li className="flex gap-2">
          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-orange-700 text-white text-xs font-bold flex items-center justify-center">1</span>
          <div className="flex-1">
            Acesse o <strong>SIFAT</strong> no <strong>Retaguarda</strong>
          </div>
        </li>
        <li className="flex gap-2">
          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-orange-700 text-white text-xs font-bold flex items-center justify-center">2</span>
          <div className="flex-1">
            Clique na aba <strong>Relatório</strong>
          </div>
        </li>
        <li className="flex gap-2">
          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-orange-700 text-white text-xs font-bold flex items-center justify-center">3</span>
          <div className="flex-1">
            Selecione <strong>Vendas Por Finalizadoras (Conciliado)</strong>
          </div>
        </li>
        <li className="flex gap-2">
          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-orange-700 text-white text-xs font-bold flex items-center justify-center">4</span>
          <div className="flex-1">
            Salve o relatório em PDF e envie no campo <strong>PDF do ERP</strong> abaixo.
            Não precisa editar o arquivo — o app já está configurado para ler direto.
          </div>
        </li>
      </ol>
    </div>
  );
}

function FileDropZone({ label, sublabel, icon: Icon, accept, file, onFile, onClear, disabled }) {
  const [dragging, setDragging] = useState(false);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={`relative border-2 border-dashed rounded-lg p-6 transition-all ${
        dragging
          ? "border-red-700 bg-red-50"
          : file
          ? "border-emerald-600 bg-emerald-50/40"
          : "border-stone-300 bg-stone-50/50 hover:border-stone-400"
      }`}
    >
      {file ? (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-md bg-emerald-100 flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5 text-emerald-700" />
            </div>
            <div>
              <p className="font-serif text-sm font-semibold text-stone-900">{label}</p>
              <p className="text-xs text-stone-600 truncate max-w-xs">{file.name}</p>
            </div>
          </div>
          <button
            onClick={onClear}
            className="p-1.5 rounded-md hover:bg-stone-200 transition-colors"
            aria-label="Remover"
          >
            <X className="w-4 h-4 text-stone-600" />
          </button>
        </div>
      ) : (
        <label className="flex flex-col items-center justify-center cursor-pointer text-center">
          <Icon className="w-8 h-8 text-stone-400 mb-2" />
          <p className="font-serif text-sm font-semibold text-stone-800">{label}</p>
          <p className="text-xs text-stone-500 mt-1">{sublabel}</p>
          <p className="text-xs text-red-700 mt-2 font-medium">Clique ou arraste aqui</p>
          <input
            type="file"
            accept={accept}
            className="hidden"
            disabled={disabled}
            onChange={(e) => {
              const f = e.target.files[0];
              if (f) onFile(f);
            }}
          />
        </label>
      )}
    </div>
  );
}

function StatCard({ label, value, sublabel, accent, icon: Icon }) {
  const accentColors = {
    red: "border-red-200 bg-red-50/60",
    green: "border-emerald-200 bg-emerald-50/60",
    amber: "border-red-200 bg-red-50/60",
    stone: "border-stone-200 bg-white",
    purple: "border-purple-200 bg-purple-50/60",
    orange: "border-orange-200 bg-orange-50/60",
  };
  const textColors = {
    red: "text-red-900",
    green: "text-emerald-800",
    amber: "text-red-800",
    stone: "text-stone-900",
    purple: "text-purple-900",
    orange: "text-orange-900",
  };
  return (
    <div className={`border rounded-lg p-4 ${accentColors[accent]}`}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs uppercase tracking-wider font-semibold text-stone-600">{label}</p>
        {Icon && <Icon className={`w-4 h-4 ${textColors[accent]}`} />}
      </div>
      <p className={`font-serif text-3xl font-bold ${textColors[accent]}`}>{value}</p>
      {sublabel && <p className="text-xs text-stone-600 mt-1">{sublabel}</p>}
    </div>
  );
}

function ConciliacaoModule({ colorTable }) {
  const [pedidosFile, setPedidosFile] = useState(null);
  const [sifatFile, setSifatFile] = useState(null);
  const [pedidos, setPedidos] = useState([]);
  const [sifat, setSifat] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [activeView, setActiveView] = useState("esquecidos");

  const handlePedidos = async (f) => {
    setError("");
    setLoading(true);
    setPedidosFile(f);
    try {
      const items = await readPedidosFile(f);
      setPedidos(items);
    } catch (e) {
      setError("Erro ao ler planilha de pedidos: " + e.message);
      setPedidosFile(null);
    } finally {
      setLoading(false);
    }
  };

  const handleSifat = async (f) => {
    setError("");
    setLoading(true);
    setSifatFile(f);
    try {
      const items = await readSifatFile(f);
      setSifat(items);
    } catch (e) {
      setError("Erro ao ler relatório do SIFAT: " + e.message);
      setSifatFile(null);
    } finally {
      setLoading(false);
    }
  };

  const result = useMemo(() => {
    if (!pedidos.length || !sifat.length) return null;
    return conciliar(sifat, pedidos, colorTable);
  }, [pedidos, sifat, colorTable]);

  const filteredEsquecidos = useMemo(() => {
    if (!result) return [];
    const t = searchTerm.toLowerCase();
    if (!t) return result.esquecidos;
    return result.esquecidos.filter(
      (e) =>
        e.sifat.descricao.toLowerCase().includes(t) ||
        e.sifat.codigo.includes(t) ||
        e.sifat.modelo.toLowerCase().includes(t)
    );
  }, [result, searchTerm]);

  const filteredCobertos = useMemo(() => {
    if (!result) return [];
    const t = searchTerm.toLowerCase();
    if (!t) return result.cobertos;
    return result.cobertos.filter(
      (e) =>
        e.sifat.descricao.toLowerCase().includes(t) ||
        e.sifat.codigo.includes(t) ||
        e.sifat.modelo.toLowerCase().includes(t)
    );
  }, [result, searchTerm]);

  const filteredSemNegativo = useMemo(() => {
    if (!result) return [];
    const t = searchTerm.toLowerCase();
    if (!t) return result.semNegativo;
    return result.semNegativo.filter(
      (p) =>
        p.modelo.toLowerCase().includes(t) ||
        p.cliente.toLowerCase().includes(t) ||
        p.numeroPedido.toLowerCase().includes(t) ||
        p.corNome.toLowerCase().includes(t)
    );
  }, [result, searchTerm]);

  const exportarAtual = () => {
    if (!result) return;

    // Data de hoje pro nome do arquivo (formato YYYY-MM-DD)
    const hoje = new Date().toISOString().slice(0, 10);

    let rows = [];
    let sheetName = "";
    let fileName = "";

    if (activeView === "esquecidos") {
      rows = result.esquecidos.map((e) => ({
        "Código SIFAT": e.sifat.codigo,
        Descrição: e.sifat.descricao,
        Modelo: e.sifat.modelo,
        Medida: e.sifat.medida,
        "Código Cor": e.sifat.corCodigo,
        "Nome Cor": e.sifat.corNome,
        "Qtde Negativa": e.sifat.quantidadeNegativa,
        "Qtde Pedida": e.qtdPedida,
        "Qtde Faltando": e.faltam,
      }));
      sheetName = "Encomendas Nao Realizadas";
      fileName = `encomendas-nao-realizadas_${hoje}.xlsx`;
    } else if (activeView === "cobertos") {
      // Conciliados — uma linha por PEDIDO vinculado (pra ficar mais útil)
      rows = result.cobertos.flatMap((e) =>
        e.pedidos.map((p) => ({
          "Código SIFAT": e.sifat.codigo,
          "Produto": e.sifat.descricao,
          "Modelo": e.sifat.modelo,
          "Medida": e.sifat.medida,
          "Código Cor": e.sifat.corCodigo,
          "Nome Cor": e.sifat.corNome,
          "Qtde Negativa": e.sifat.quantidadeNegativa,
          "Nº Pedido": p.numeroPedido,
          "Cliente": p.cliente,
          "Fornecedor": p.fornecedor,
          "Data": p.data,
          "Qtde Pedida": p.quantidade,
          "Obs": p.obs,
        }))
      );
      sheetName = "Conciliados";
      fileName = `conciliados_${hoje}.xlsx`;
    } else if (activeView === "semNegativo") {
      rows = result.semNegativo.map((p) => ({
        "Nº Pedido": p.numeroPedido,
        "Cliente": p.cliente,
        "Modelo": p.modelo,
        "Medida": p.medida,
        "Código Cor": p.corCodigo,
        "Nome Cor": p.corNome,
        "Fornecedor": p.fornecedor,
        "Data": p.data,
        "Qtde Pedida": p.quantidade,
        "Obs": p.obs,
      }));
      sheetName = "Divergencias";
      fileName = `divergencias_${hoje}.xlsx`;
    }

    if (rows.length === 0) return;

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, fileName);
  };

  const reset = () => {
    setPedidosFile(null);
    setSifatFile(null);
    setPedidos([]);
    setSifat([]);
    setError("");
    setSearchTerm("");
  };

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header do módulo */}
      <div className="mb-8 border-b border-stone-200 pb-6">
        <div className="flex items-baseline gap-3 mb-2">
          <span className="text-xs uppercase tracking-[0.2em] text-red-700 font-semibold">
            Módulo 01
          </span>
          <span className="text-stone-300">—</span>
          <span className="text-xs uppercase tracking-wider text-stone-500">
            Estoque & Encomendas
          </span>
        </div>
        <h1 className="font-serif text-4xl font-bold text-stone-900 tracking-tight">
          Conciliação dos Pedidos com os Negativos do Sistema
        </h1>
        <p className="text-stone-600 mt-2 max-w-2xl">
          Cruza o relatório de estoque negativo do <strong>SIFAT</strong> com a planilha de
          pedidos da loja para identificar itens que ficaram sem encomenda.
        </p>
      </div>

      {/* Upload */}
      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <FileDropZone
          label="Produtos Encomendados"
          sublabel="Planilha .xlsx exportada do sistema de pedidos"
          icon={FileSpreadsheet}
          accept=".xlsx,.xls,.csv"
          file={pedidosFile}
          onFile={handlePedidos}
          onClear={() => {
            setPedidosFile(null);
            setPedidos([]);
          }}
          disabled={loading}
        />
        <FileDropZone
          label="Estoque Negativo (SIFAT)"
          sublabel="PDF, Excel ou CSV"
          icon={FileText}
          accept=".pdf,.xlsx,.xls,.csv"
          file={sifatFile}
          onFile={handleSifat}
          onClear={() => {
            setSifatFile(null);
            setSifat([]);
          }}
          disabled={loading}
        />
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-stone-600 text-sm mb-4">
          <Loader2 className="w-4 h-4 animate-spin" />
          Processando arquivo…
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-900 rounded-lg p-4 mb-4">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {/* Resultado */}
      {result && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <StatCard
              label="Encomendas Não Realizadas"
              value={result.esquecidos.length}
              sublabel="negativo sem pedido"
              accent="red"
              icon={XCircle}
            />
            <StatCard
              label="Divergências"
              value={result.semNegativo.length}
              sublabel="pedido sem negativo"
              accent="amber"
              icon={AlertTriangle}
            />
            <StatCard
              label="Conciliados"
              value={result.cobertos.length}
              sublabel="tudo certo"
              accent="green"
              icon={CheckCircle2}
            />
            <StatCard
              label="Total processado"
              value={`${sifat.length} / ${pedidos.length}`}
              sublabel="negativos / pedidos"
              accent="stone"
              icon={Package}
            />
          </div>

          {/* Barra de ações */}
          <div className="flex flex-wrap items-center gap-3 mb-4 pb-4 border-b border-stone-200">
            <div className="flex bg-stone-100 rounded-md p-1 flex-wrap">
              <button
                onClick={() => setActiveView("esquecidos")}
                className={`px-4 py-1.5 text-sm font-medium rounded transition-colors ${
                  activeView === "esquecidos"
                    ? "bg-white text-red-900 shadow-sm"
                    : "text-stone-600 hover:text-stone-900"
                }`}
              >
                Encomendas Não Realizadas ({result.esquecidos.length})
              </button>
              <button
                onClick={() => setActiveView("semNegativo")}
                className={`px-4 py-1.5 text-sm font-medium rounded transition-colors ${
                  activeView === "semNegativo"
                    ? "bg-white text-red-800 shadow-sm"
                    : "text-stone-600 hover:text-stone-900"
                }`}
              >
                Divergências ({result.semNegativo.length})
              </button>
              <button
                onClick={() => setActiveView("cobertos")}
                className={`px-4 py-1.5 text-sm font-medium rounded transition-colors ${
                  activeView === "cobertos"
                    ? "bg-white text-emerald-800 shadow-sm"
                    : "text-stone-600 hover:text-stone-900"
                }`}
              >
                Conciliados ({result.cobertos.length})
              </button>
            </div>

            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
              <input
                type="text"
                placeholder="Buscar por código, modelo ou descrição…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm border border-stone-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-red-700/30 focus:border-red-700"
              />
            </div>

            <div className="flex gap-2 ml-auto">
              <button
                onClick={exportarAtual}
                disabled={
                  (activeView === "esquecidos" && !result.esquecidos.length) ||
                  (activeView === "cobertos" && !result.cobertos.length) ||
                  (activeView === "semNegativo" && !result.semNegativo.length)
                }
                className="flex items-center gap-2 px-3 py-2 text-sm border border-stone-300 rounded-md bg-white hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed"
                title="Baixar a aba atual em Excel"
              >
                <Download className="w-4 h-4" />
                Baixar Excel
              </button>
              <button
                onClick={reset}
                className="px-3 py-2 text-sm text-stone-600 hover:text-stone-900"
              >
                Reiniciar
              </button>
            </div>
          </div>

          {/* Lista */}
          {activeView === "esquecidos" && <EsquecidosList items={filteredEsquecidos} />}
          {activeView === "semNegativo" && <SemNegativoList items={filteredSemNegativo} />}
          {activeView === "cobertos" && <CobertosList items={filteredCobertos} />}
        </>
      )}

      {!result && !loading && (pedidosFile || sifatFile) && (
        <div className="text-center py-12 text-stone-500 text-sm">
          Envie os dois arquivos para iniciar a conciliação.
        </div>
      )}

      {!pedidosFile && !sifatFile && !loading && (
        <div className="text-center py-16 bg-gradient-to-b from-red-50/40 to-transparent rounded-lg border border-stone-200">
          <GitCompare className="w-10 h-10 text-red-700 mx-auto mb-3" />
          <p className="font-serif text-lg text-stone-800 mb-1">
            Pronto para conciliar
          </p>
          <p className="text-sm text-stone-600 max-w-md mx-auto">
            Envie a planilha de pedidos da loja e o relatório de estoque negativo do SIFAT para
            identificar itens que ficaram sem encomenda.
          </p>
        </div>
      )}
    </div>
  );
}

function EsquecidosList({ items }) {
  if (!items.length) {
    return (
      <div className="text-center py-12">
        <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto mb-3" />
        <p className="font-serif text-lg text-stone-800">Nenhuma encomenda não realizada</p>
        <p className="text-sm text-stone-600 mt-1">
          Todos os negativos do SIFAT têm pedido correspondente.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((e, i) => (
        <div
          key={i}
          className="border border-red-200 bg-white rounded-lg overflow-hidden"
        >
          <div className="flex items-start p-4 gap-4">
            <div className="w-10 h-10 rounded-md bg-red-100 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-5 h-5 text-red-700" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-xs font-mono text-stone-500">
                  #{e.sifat.codigo}
                </span>
                <h3 className="font-serif font-semibold text-stone-900 truncate">
                  {e.sifat.descricao}
                </h3>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-600">
                <span>
                  Modelo: <strong className="text-stone-900">{e.sifat.modelo}</strong>
                </span>
                {e.sifat.medida && (
                  <span>
                    Medida: <strong className="text-stone-900">{e.sifat.medida}</strong>
                  </span>
                )}
                <span>
                  Cor:{" "}
                  <strong className="text-stone-900">
                    {e.sifat.corCodigo} {e.sifat.corNome}
                  </strong>
                </span>
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <div className="flex items-center gap-4">
                <div>
                  <p className="text-xs text-stone-500 uppercase tracking-wider">Negativo</p>
                  <p className="font-serif text-xl font-bold text-stone-900">
                    {e.sifat.quantidadeNegativa}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-stone-500 uppercase tracking-wider">Pedido</p>
                  <p className="font-serif text-xl font-bold text-stone-500">
                    {e.qtdPedida}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-red-700 uppercase tracking-wider font-semibold">
                    Faltam
                  </p>
                  <p className="font-serif text-2xl font-bold text-red-700">
                    {e.faltam}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function CobertosList({ items }) {
  const [expanded, setExpanded] = useState(null);

  if (!items.length) {
    return (
      <div className="text-center py-12 text-stone-500 text-sm">
        Nenhum item conciliado ainda.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((e, i) => (
        <div
          key={i}
          className="border border-emerald-200 bg-white rounded-lg overflow-hidden"
        >
          <button
            onClick={() => setExpanded(expanded === i ? null : i)}
            className="w-full flex items-start p-4 gap-4 text-left hover:bg-emerald-50/30 transition-colors"
          >
            <div className="w-10 h-10 rounded-md bg-emerald-100 flex items-center justify-center flex-shrink-0">
              <CheckCircle2 className="w-5 h-5 text-emerald-700" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-xs font-mono text-stone-500">
                  #{e.sifat.codigo}
                </span>
                <h3 className="font-serif font-semibold text-stone-900 truncate">
                  {e.sifat.descricao}
                </h3>
              </div>
              <div className="flex flex-wrap gap-x-4 text-xs text-stone-600">
                <span>
                  Cor:{" "}
                  <strong className="text-stone-900">
                    {e.sifat.corCodigo} {e.sifat.corNome}
                  </strong>
                </span>
                <span>
                  Pedidos vinculados:{" "}
                  <strong className="text-emerald-800">{e.pedidos.length}</strong>
                </span>
              </div>
            </div>
            <div className="flex items-center gap-4 flex-shrink-0">
              <div className="text-right">
                <p className="text-xs text-emerald-700 uppercase tracking-wider font-semibold">
                  Quantidade
                </p>
                <p className="font-serif text-xl font-bold text-emerald-800">
                  {e.qtdPedida}/{e.sifat.quantidadeNegativa}
                </p>
              </div>
              <ChevronRight
                className={`w-4 h-4 text-stone-400 transition-transform ${
                  expanded === i ? "rotate-90" : ""
                }`}
              />
            </div>
          </button>
          {expanded === i && (
            <div className="border-t border-emerald-100 bg-emerald-50/30 p-4">
              <p className="text-xs uppercase tracking-wider font-semibold text-stone-600 mb-2">
                Pedidos vinculados
              </p>
              <div className="space-y-2">
                {e.pedidos.map((p, j) => (
                  <div
                    key={j}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm bg-white border border-stone-200 rounded p-2"
                  >
                    <span className="font-mono text-xs text-stone-500">
                      {p.numeroPedido}
                    </span>
                    <span className="font-medium text-stone-900">{p.cliente}</span>
                    <span className="text-stone-600">{p.fornecedor}</span>
                    <span className="text-stone-500 text-xs">{p.data}</span>
                    <span className="ml-auto font-serif font-bold text-stone-900">
                      {p.quantidade}×
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function SemNegativoList({ items }) {
  if (!items.length) {
    return (
      <div className="text-center py-12">
        <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto mb-3" />
        <p className="font-serif text-lg text-stone-800">Nenhuma divergência</p>
        <p className="text-sm text-stone-600 mt-1">
          Todos os pedidos têm produto correspondente em negativo no SIFAT.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-3 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-red-700 mt-0.5 flex-shrink-0" />
        <div className="text-xs text-red-800">
          <p className="mb-2">
            <strong>Pedidos lançados mas o produto NÃO está negativo no SIFAT.</strong>
          </p>
          <p className="mb-1 font-semibold">Possíveis causas:</p>
          <ul className="list-disc list-inside space-y-0.5 pl-1">
            <li>Pode se tratar de uma troca</li>
            <li>O produto já estava em estoque e, mesmo assim, foi feita a encomenda</li>
            <li>O pedido não foi finalizado corretamente</li>
            <li>Divergência de estoque (estoque não confere com o sistema)</li>
          </ul>
        </div>
      </div>

      {items.map((p, i) => (
        <div
          key={i}
          className="border border-red-200 bg-white rounded-lg overflow-hidden"
        >
          <div className="flex items-start p-4 gap-4">
            <div className="w-10 h-10 rounded-md bg-red-100 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-5 h-5 text-red-700" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-xs font-mono text-stone-500">
                  {p.numeroPedido}
                </span>
                <h3 className="font-serif font-semibold text-stone-900 truncate">
                  {p.modelo}
                  {p.medida && ` — ${p.medida}`}
                </h3>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-600">
                <span>
                  Cliente: <strong className="text-stone-900">{p.cliente}</strong>
                </span>
                <span>
                  Cor:{" "}
                  <strong className="text-stone-900">
                    {p.corCodigo} {p.corNome}
                  </strong>
                </span>
                <span>
                  Fornecedor: <strong className="text-stone-900">{p.fornecedor}</strong>
                </span>
                <span>Data: <strong className="text-stone-900">{p.data}</strong></span>
                {p.obs && (
                  <span className="text-red-700">
                    Obs: <strong>{p.obs}</strong>
                  </span>
                )}
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-xs text-stone-500 uppercase tracking-wider">Quantidade</p>
              <p className="font-serif text-2xl font-bold text-red-700">
                {p.quantidade}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ColorTableModule({ table, onSave, supabaseError }) {
  const [editing, setEditing] = useState(null); // index sendo editado
  const [draft, setDraft] = useState({ codigo: "", nome: "" });
  const [adding, setAdding] = useState(false);
  const [newEntry, setNewEntry] = useState({ codigo: "", nome: "" });
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");

  const filtered = useMemo(() => {
    const t = search.toLowerCase().trim();
    if (!t) return table;
    return table.filter(
      (c) =>
        c.codigo.toLowerCase().includes(t) || c.nome.toLowerCase().includes(t)
    );
  }, [table, search]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => a.codigo.localeCompare(b.codigo));
  }, [filtered]);

  const startEdit = (index) => {
    setEditing(index);
    setDraft({ ...table[index] });
  };

  const cancelEdit = () => {
    setEditing(null);
    setDraft({ codigo: "", nome: "" });
  };

  const persistSave = async (newTable) => {
    setSaving(true);
    setSaveStatus("");
    const ok = await onSave(newTable);
    setSaving(false);
    setSaveStatus(ok ? "Salvo" : "Erro");
    setTimeout(() => setSaveStatus(""), 3000);
    return ok;
  };

  const saveEdit = async () => {
    if (!draft.codigo.trim() || !draft.nome.trim()) return;
    const newCodigo = draft.codigo.trim().toUpperCase();
    // Evita duplicata ao editar pra um código que já existe em outra linha
    const duplicate = table.some(
      (c, i) => i !== editing && c.codigo.toUpperCase() === newCodigo
    );
    if (duplicate) {
      alert(`Código ${newCodigo} já existe na tabela.`);
      return;
    }
    const newTable = table.map((c, i) =>
      i === editing
        ? { codigo: newCodigo, nome: draft.nome.trim().toUpperCase() }
        : c
    );
    const ok = await persistSave(newTable);
    if (ok) cancelEdit();
  };

  const removeEntry = async (index) => {
    const entry = table[index];
    if (!confirm(`Remover ${entry.codigo} = ${entry.nome}?`)) return;
    const newTable = table.filter((_, i) => i !== index);
    await persistSave(newTable);
  };

  const addEntry = async () => {
    const codigo = newEntry.codigo.trim().toUpperCase();
    const nome = newEntry.nome.trim().toUpperCase();
    if (!codigo || !nome) return;
    if (table.some((c) => c.codigo.toUpperCase() === codigo)) {
      alert(`Código ${codigo} já existe na tabela.`);
      return;
    }
    const newTable = [...table, { codigo, nome }];
    const ok = await persistSave(newTable);
    if (ok) {
      setNewEntry({ codigo: "", nome: "" });
      setAdding(false);
    }
  };

  const restoreDefaults = async () => {
    if (
      !confirm(
        "Restaurar a tabela para os valores padrão? As cores adicionadas serão removidas."
      )
    )
      return;
    await persistSave(DEFAULT_COLOR_TABLE);
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8 border-b border-stone-200 pb-6">
        <div className="flex items-baseline gap-3 mb-2">
          <span className="text-xs uppercase tracking-[0.2em] text-red-700 font-semibold">
            Cadastro
          </span>
          <span className="text-stone-300">—</span>
          <span className="text-xs uppercase tracking-wider text-stone-500">
            Sinônimos de Cor
          </span>
        </div>
        <h1 className="font-serif text-4xl font-bold text-stone-900 tracking-tight">
          Tabela de Cores
        </h1>
        <p className="text-stone-600 mt-2 max-w-2xl">
          Relaciona o <strong>código da cor</strong> do SIFAT com o{" "}
          <strong>nome da cor</strong>. Usada na conciliação quando a loja lançar
          o pedido só pelo nome (ex: "MARROM") sem o código.
        </p>
        <div className="flex items-start gap-2 mt-3 text-xs text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
          <Users className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>
            <strong>Tabela compartilhada entre todas as lojas.</strong> Quando uma loja
            cadastra uma cor aqui, todas as outras passam a ver. Salvo no banco de dados
            (Supabase).
          </span>
        </div>
      </div>

      {/* Mensagem de erro do Supabase (vinda do hook) */}
      {supabaseError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-700 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-900">{supabaseError}</p>
        </div>
      )}

      {/* Barra de ações */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
          <input
            type="text"
            placeholder="Buscar código ou nome…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-stone-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-red-700/30 focus:border-red-700"
          />
        </div>
        <button
          onClick={() => {
            setAdding(true);
            setNewEntry({ codigo: "", nome: "" });
          }}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-red-700 text-white rounded-md hover:bg-red-800 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Nova cor
        </button>
        <button
          onClick={restoreDefaults}
          className="flex items-center gap-2 px-3 py-2 text-sm text-stone-600 border border-stone-300 rounded-md bg-white hover:bg-stone-50"
          title="Restaurar tabela padrão"
        >
          <RotateCcw className="w-4 h-4" />
          <span className="hidden sm:inline">Padrão</span>
        </button>
        {saveStatus && (
          <div
            className={`flex items-center gap-1.5 px-3 py-2 text-xs rounded-md ${
              saveStatus === "Salvo"
                ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                : "bg-red-50 text-red-800 border border-red-200"
            }`}
          >
            {saveStatus === "Salvo" ? (
              <CheckCircle2 className="w-3.5 h-3.5" />
            ) : (
              <AlertTriangle className="w-3.5 h-3.5" />
            )}
            {saveStatus}
          </div>
        )}
        {saving && (
          <div className="flex items-center gap-1.5 px-3 py-2 text-xs text-stone-600">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Salvando…
          </div>
        )}
      </div>

      {/* Linha de adição */}
      {adding && (
        <div className="border-2 border-red-400 bg-red-50/50 rounded-lg p-3 mb-3 flex flex-wrap items-center gap-2">
          <input
            type="text"
            placeholder="Código (ex: 33302)"
            value={newEntry.codigo}
            onChange={(e) =>
              setNewEntry({ ...newEntry, codigo: e.target.value })
            }
            autoFocus
            className="px-3 py-2 text-sm border border-stone-300 rounded-md bg-white font-mono w-40 focus:outline-none focus:ring-2 focus:ring-red-700/30"
          />
          <input
            type="text"
            placeholder="Nome (ex: MARROM)"
            value={newEntry.nome}
            onChange={(e) => setNewEntry({ ...newEntry, nome: e.target.value })}
            className="px-3 py-2 text-sm border border-stone-300 rounded-md bg-white flex-1 min-w-[180px] focus:outline-none focus:ring-2 focus:ring-red-700/30"
            onKeyDown={(e) => {
              if (e.key === "Enter") addEntry();
              if (e.key === "Escape") setAdding(false);
            }}
          />
          <button
            onClick={addEntry}
            disabled={!newEntry.codigo.trim() || !newEntry.nome.trim() || saving}
            className="flex items-center gap-1.5 px-3 py-2 text-sm bg-emerald-700 text-white rounded-md hover:bg-emerald-800 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Save className="w-4 h-4" />
            Salvar
          </button>
          <button
            onClick={() => setAdding(false)}
            className="px-3 py-2 text-sm text-stone-600 hover:text-stone-900"
          >
            Cancelar
          </button>
        </div>
      )}

      {/* Tabela */}
      <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
        <div className="grid grid-cols-[140px_1fr_auto] gap-3 px-4 py-2.5 bg-stone-50 border-b border-stone-200 text-[11px] uppercase tracking-wider font-semibold text-stone-600">
          <div>Código</div>
          <div>Nome da Cor</div>
          <div className="pr-2">Ações</div>
        </div>

        {sorted.length === 0 ? (
          <div className="text-center py-12 text-stone-500 text-sm">
            {search
              ? "Nenhuma cor encontrada com esse termo."
              : "Nenhuma cor cadastrada."}
          </div>
        ) : (
          sorted.map((entry) => {
            const realIndex = table.findIndex(
              (c) => c.codigo === entry.codigo
            );
            const isEditing = editing === realIndex;
            return (
              <div
                key={entry.codigo}
                className={`grid grid-cols-[140px_1fr_auto] gap-3 px-4 py-2.5 border-b border-stone-100 items-center ${
                  isEditing ? "bg-red-50/40" : "hover:bg-stone-50/50"
                }`}
              >
                {isEditing ? (
                  <>
                    <input
                      type="text"
                      value={draft.codigo}
                      onChange={(e) =>
                        setDraft({ ...draft, codigo: e.target.value })
                      }
                      className="px-2 py-1.5 text-sm border border-stone-300 rounded bg-white font-mono w-full focus:outline-none focus:ring-2 focus:ring-red-700/30"
                    />
                    <input
                      type="text"
                      value={draft.nome}
                      onChange={(e) =>
                        setDraft({ ...draft, nome: e.target.value })
                      }
                      className="px-2 py-1.5 text-sm border border-stone-300 rounded bg-white focus:outline-none focus:ring-2 focus:ring-red-700/30"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveEdit();
                        if (e.key === "Escape") cancelEdit();
                      }}
                    />
                    <div className="flex items-center gap-1 pr-1">
                      <button
                        onClick={saveEdit}
                        className="p-1.5 text-emerald-700 hover:bg-emerald-100 rounded"
                        title="Salvar"
                      >
                        <Save className="w-4 h-4" />
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="p-1.5 text-stone-500 hover:bg-stone-100 rounded"
                        title="Cancelar"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="font-mono text-sm text-stone-900 font-semibold">
                      {entry.codigo}
                    </div>
                    <div className="text-sm text-stone-800">{entry.nome}</div>
                    <div className="flex items-center gap-1 pr-1">
                      <button
                        onClick={() => startEdit(realIndex)}
                        className="p-1.5 text-stone-500 hover:bg-stone-100 hover:text-stone-900 rounded transition-colors"
                        title="Editar"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => removeEntry(realIndex)}
                        className="p-1.5 text-stone-500 hover:bg-red-50 hover:text-red-700 rounded transition-colors"
                        title="Remover"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>

      <p className="text-xs text-stone-500 mt-4">
        Total: <strong>{table.length}</strong> cor{table.length === 1 ? "" : "es"} cadastrada{table.length === 1 ? "" : "s"}.
      </p>
    </div>
  );
}

// ============================================================
// MÓDULO: TABELA DE TAXAS (Blu / Pague Veloz)
// ============================================================

function TaxasModule({ taxasBlu, onSaveTaxasBlu, taxasPV, onSaveTaxasPV, supabaseErrorBlu, supabaseErrorPV }) {
  // Aba ativa (qual maquininha está sendo editada)
  const [maquininhaAtiva, setMaquininhaAtiva] = useState("blu");
  // Estado de "rascunho" — a usuária edita aqui antes de salvar
  const [rascunho, setRascunho] = useState(taxasBlu);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");

  // Erro do Supabase relevante pra aba ativa
  const supabaseError = maquininhaAtiva === "blu" ? supabaseErrorBlu : supabaseErrorPV;

  // Quando muda a tabela vinda do hook (ou troca de maquininha), atualiza o rascunho
  useEffect(() => {
    if (maquininhaAtiva === "blu") {
      setRascunho(taxasBlu);
    } else {
      setRascunho(taxasPV);
    }
    setSaveStatus("");
  }, [maquininhaAtiva, taxasBlu, taxasPV]);

  // Detecta se houve mudança em relação ao salvo
  const hasChanges = useMemo(() => {
    const original = maquininhaAtiva === "blu" ? taxasBlu : taxasPV;
    return JSON.stringify(rascunho) !== JSON.stringify(original);
  }, [rascunho, taxasBlu, taxasPV, maquininhaAtiva]);

  // Onchange Blu (estrutura 2 níveis: tipo.grupo)
  const onChangeTaxaBlu = (tipoId, grupoId, valor) => {
    let num = null;
    if (valor !== "" && valor != null) {
      const limpo = String(valor).replace(",", ".").trim();
      const n = parseFloat(limpo);
      if (!isNaN(n)) num = n;
    }
    setRascunho((prev) => ({
      ...prev,
      [tipoId]: { ...prev[tipoId], [grupoId]: num },
    }));
  };

  // Onchange PV (estrutura 1 nível: linha)
  const onChangeTaxaPV = (linhaId, valor) => {
    let num = null;
    if (valor !== "" && valor != null) {
      const limpo = String(valor).replace(",", ".").trim();
      const n = parseFloat(limpo);
      if (!isNaN(n)) num = n;
    }
    setRascunho((prev) => ({ ...prev, [linhaId]: num }));
  };

  const salvar = async () => {
    setSaving(true);
    setSaveStatus("");
    const ok = maquininhaAtiva === "blu"
      ? await onSaveTaxasBlu(rascunho)
      : await onSaveTaxasPV(rascunho);
    setSaving(false);
    setSaveStatus(ok ? "Salvo" : "Erro");
    setTimeout(() => setSaveStatus(""), 3000);
  };

  const cancelar = () => {
    if (maquininhaAtiva === "blu") {
      setRascunho(taxasBlu);
    } else {
      setRascunho(taxasPV);
    }
    setSaveStatus("");
  };

  const restaurarPadrao = async () => {
    const nomeMaquininha = maquininhaAtiva === "blu" ? "Blu" : "Pague Veloz";
    const padrao = maquininhaAtiva === "blu" ? DEFAULT_TAXAS_BLU : DEFAULT_TAXAS_PV;
    if (!confirm(`Restaurar as taxas ${nomeMaquininha} para os valores padrão?\nSuas alterações serão perdidas.`)) return;
    setSaving(true);
    const ok = maquininhaAtiva === "blu"
      ? await onSaveTaxasBlu(padrao)
      : await onSaveTaxasPV(padrao);
    setSaving(false);
    setSaveStatus(ok ? "Salvo" : "Erro");
    setTimeout(() => setSaveStatus(""), 3000);
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8 border-b border-stone-200 pb-6">
        <div className="flex items-baseline gap-3 mb-2">
          <span className="text-xs uppercase tracking-[0.2em] text-red-700 font-semibold">
            Cadastro
          </span>
          <span className="text-stone-300">—</span>
          <span className="text-xs uppercase tracking-wider text-stone-500">
            Taxas Negociadas
          </span>
        </div>
        <h1 className="font-serif text-4xl font-bold text-stone-900 tracking-tight">
          Tabelas de Taxas de Cartões
        </h1>
        <p className="text-stone-600 mt-2 max-w-2xl">
          Cadastre as taxas <strong>negociadas no contrato</strong> com cada maquininha.
          Na Conciliação Financeira, o app vai comparar essas taxas com o que foi cobrado
          de fato e te avisar se houver cobrança acima do acordado.
        </p>
        <div className="flex items-start gap-2 mt-3 text-xs text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
          <Users className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>
            <strong>Tabelas compartilhadas entre todas as lojas.</strong> Quando o contrato mudar,
            atualize aqui e todas as lojas passam a ver os novos valores. Salvo no banco de dados (Supabase).
          </span>
        </div>
      </div>

      {/* Mensagem de erro do Supabase */}
      {supabaseError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-700 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-900">{supabaseError}</p>
        </div>
      )}

      {/* Botões de seleção de maquininha */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setMaquininhaAtiva("blu")}
          className={`flex items-center gap-2 px-4 py-2 rounded-md font-medium transition-colors ${
            maquininhaAtiva === "blu"
              ? "bg-purple-700 text-white shadow-sm"
              : "bg-white text-stone-700 border border-stone-300 hover:bg-stone-50"
          }`}
        >
          <CreditCard className="w-4 h-4" />
          Blu (SS Express e Lupe)
        </button>
        <button
          onClick={() => setMaquininhaAtiva("pague_veloz")}
          className={`flex items-center gap-2 px-4 py-2 rounded-md font-medium transition-colors ${
            maquininhaAtiva === "pague_veloz"
              ? "bg-blue-700 text-white shadow-sm"
              : "bg-white text-stone-700 border border-stone-300 hover:bg-stone-50"
          }`}
        >
          <Landmark className="w-4 h-4" />
          Pague Veloz Express
        </button>
      </div>

      {/* === TABELA BLU (6 linhas × 2 colunas: Visa/Master, Amex/Elo) === */}
      {maquininhaAtiva === "blu" && (
        <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
          <div className="grid grid-cols-[1fr_180px_180px] gap-3 px-4 py-2.5 bg-stone-50 border-b border-stone-200 text-[11px] uppercase tracking-wider font-semibold text-stone-600">
            <div>Tipo de Operação</div>
            {GRUPOS_BANDEIRA_BLU.map((g) => (
              <div key={g.id} className="text-center">{g.nome}</div>
            ))}
          </div>

          {TIPOS_OPERACAO_BLU.map((tipo, idx) => {
            const isLast = idx === TIPOS_OPERACAO_BLU.length - 1;
            return (
              <div
                key={tipo.id}
                className={`grid grid-cols-[1fr_180px_180px] gap-3 px-4 py-3 items-center ${
                  isLast ? "" : "border-b border-stone-100"
                } ${idx % 2 === 1 ? "bg-stone-50/40" : ""}`}
              >
                <div className="text-sm font-medium text-stone-800">{tipo.nome}</div>
                {GRUPOS_BANDEIRA_BLU.map((grupo) => {
                  const valorAtual = rascunho?.[tipo.id]?.[grupo.id];
                  const valorStr =
                    valorAtual === null || valorAtual === undefined
                      ? ""
                      : String(valorAtual).replace(".", ",");
                  return (
                    <div key={grupo.id} className="flex items-center justify-center">
                      <div className="relative w-32">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={valorStr}
                          onChange={(e) => onChangeTaxaBlu(tipo.id, grupo.id, e.target.value)}
                          placeholder="—"
                          className="w-full pl-3 pr-8 py-1.5 text-sm text-right border border-stone-300 rounded bg-white font-mono focus:outline-none focus:ring-2 focus:ring-red-700/30 focus:border-red-700"
                        />
                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 text-sm pointer-events-none">
                          %
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {/* === TABELA PAGUE VELOZ (22 linhas × 1 coluna: Taxa Pagar) === */}
      {maquininhaAtiva === "pague_veloz" && (
        <>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 flex items-start gap-2 text-xs text-blue-900">
            <AlertCircle className="w-4 h-4 text-blue-700 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-semibold mb-0.5">Como a Pague Veloz funciona</p>
              <p>
                A taxa cadastrada aqui é a <strong>"Taxa Pagar"</strong> (4ª coluna do print da PV) —
                é a taxa final descontada do lojista. Como a PV não distingue por bandeira,
                há uma única taxa por número de parcelas.
              </p>
            </div>
          </div>

          <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
            <div className="grid grid-cols-[1fr_220px] gap-3 px-4 py-2.5 bg-stone-50 border-b border-stone-200 text-[11px] uppercase tracking-wider font-semibold text-stone-600">
              <div>Parcelas</div>
              <div className="text-center">Taxa Pagar</div>
            </div>

            {LINHAS_TAXAS_PV.map((linha, idx) => {
              const isLast = idx === LINHAS_TAXAS_PV.length - 1;
              const valorAtual = rascunho?.[linha.id];
              const valorStr =
                valorAtual === null || valorAtual === undefined
                  ? ""
                  : String(valorAtual).replace(".", ",");
              return (
                <div
                  key={linha.id}
                  className={`grid grid-cols-[1fr_220px] gap-3 px-4 py-2 items-center ${
                    isLast ? "" : "border-b border-stone-100"
                  } ${idx % 2 === 1 ? "bg-stone-50/40" : ""}`}
                >
                  <div className="text-sm font-medium text-stone-800">{linha.nome}</div>
                  <div className="flex items-center justify-center">
                    <div className="relative w-40">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={valorStr}
                        onChange={(e) => onChangeTaxaPV(linha.id, e.target.value)}
                        placeholder="—"
                        className="w-full pl-3 pr-8 py-1.5 text-sm text-right border border-stone-300 rounded bg-white font-mono focus:outline-none focus:ring-2 focus:ring-red-700/30 focus:border-red-700"
                      />
                      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 text-sm pointer-events-none">
                        %
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Botões de ação */}
      <div className="flex flex-wrap items-center gap-2 mt-4">
        <button
          onClick={salvar}
          disabled={!hasChanges || saving}
          className="flex items-center gap-1.5 px-4 py-2 text-sm bg-emerald-700 text-white font-medium rounded-md hover:bg-emerald-800 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          Salvar alterações
        </button>
        <button
          onClick={cancelar}
          disabled={!hasChanges || saving}
          className="px-3 py-2 text-sm text-stone-600 hover:text-stone-900 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Descartar
        </button>
        <button
          onClick={restaurarPadrao}
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-2 text-sm text-stone-600 border border-stone-300 rounded-md bg-white hover:bg-stone-50 ml-auto"
          title={`Restaura as taxas ${maquininhaAtiva === "blu" ? "Blu" : "Pague Veloz"} para os valores padrão`}
        >
          <RotateCcw className="w-4 h-4" />
          Restaurar padrão {maquininhaAtiva === "blu" ? "Blu" : "Pague Veloz"}
        </button>
        {saveStatus && (
          <div
            className={`flex items-center gap-1.5 px-3 py-2 text-xs rounded-md ${
              saveStatus === "Salvo"
                ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                : "bg-red-50 text-red-800 border border-red-200"
            }`}
          >
            {saveStatus === "Salvo" ? (
              <CheckCircle2 className="w-3.5 h-3.5" />
            ) : (
              <AlertTriangle className="w-3.5 h-3.5" />
            )}
            {saveStatus}
          </div>
        )}
      </div>

      <p className="text-xs text-stone-500 mt-6">
        Use vírgula ou ponto para casas decimais (ex: <code>2,55</code> ou <code>2.55</code>).
        Deixe em branco se não houver taxa cadastrada para essa combinação.
      </p>
    </div>
  );
}

function FinanceiroModule({ bancoSelecionadoId, onSelecionarBanco, onTrocarBanco }) {
  // Resolve o banco a partir do ID vindo da URL
  const bancoSelecionado = useMemo(
    () => BANCOS_SUPORTADOS.find((b) => b.id === bancoSelecionadoId) || null,
    [bancoSelecionadoId]
  );

  const trocarBanco = () => {
    onTrocarBanco();
  };

  // === SELEÇÃO DE BANCO ===
  if (!bancoSelecionado) {
    return (
      <div className="max-w-5xl mx-auto">
        <div className="mb-8 border-b border-stone-200 pb-6">
          <div className="flex items-baseline gap-3 mb-2">
            <span className="text-xs uppercase tracking-[0.2em] text-red-700 font-semibold">
              Módulo 02
            </span>
            <span className="text-stone-300">—</span>
            <span className="text-xs uppercase tracking-wider text-stone-500">
              Financeiro
            </span>
          </div>
          <h1 className="font-serif text-4xl font-bold text-stone-900 tracking-tight">
            Conciliação Financeira
          </h1>
          <p className="text-stone-600 mt-2 max-w-2xl">
            Compara o relatório de lançamentos do <strong>ERP</strong> com o{" "}
            <strong>extrato bancário</strong> e identifica divergências, lançamentos
            esquecidos e diferenças de data.
          </p>
        </div>

        <h2 className="font-serif text-xl font-semibold text-stone-900 mb-4">
          Escolha o banco para conciliar:
        </h2>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {BANCOS_SUPORTADOS.map((banco) => (
            <button
              key={banco.id}
              onClick={() => !banco.emBreve && onSelecionarBanco(banco.id)}
              disabled={banco.emBreve}
              className={`p-6 border-2 rounded-lg text-left transition-all ${
                banco.emBreve
                  ? "border-stone-200 bg-stone-50 cursor-not-allowed opacity-60"
                  : "border-stone-300 bg-white hover:border-red-700 hover:shadow-md"
              }`}
            >
              <div className="flex items-center gap-3 mb-2">
                {banco.tipo === "blu" ? (
                  <CreditCard
                    className={`w-6 h-6 ${
                      banco.emBreve ? "text-stone-400" : "text-purple-700"
                    }`}
                  />
                ) : (
                  <Landmark
                    className={`w-6 h-6 ${
                      banco.emBreve ? "text-stone-400" : "text-red-700"
                    }`}
                  />
                )}
                <h3 className="font-serif text-lg font-semibold text-stone-900">
                  {banco.nome}
                </h3>
              </div>
              {banco.emBreve ? (
                <span className="text-[10px] uppercase tracking-wider bg-stone-200 text-stone-600 px-2 py-0.5 rounded">
                  Em breve
                </span>
              ) : banco.tipo === "blu" ? (
                <p className="text-xs text-stone-600">
                  Conciliar vendas da maquininha com o ERP
                </p>
              ) : (
                <p className="text-xs text-stone-600">
                  Conciliar extrato deste banco com o ERP
                </p>
              )}
            </button>
          ))}
        </div>

        <div className="mt-8 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800">
          <p className="font-semibold mb-1">⚠️ Como funciona</p>
          <ul className="list-disc list-inside space-y-1 text-xs">
            <li>Suba o relatório de lançamentos do ERP (PDF ou Excel).</li>
            <li>Suba o extrato bancário do mesmo período (PDF, Excel ou CSV).</li>
            <li>
              Identifica: lançamentos esquecidos no ERP, lançamentos só no banco e
              divergências de data.
            </li>
          </ul>
        </div>
      </div>
    );
  }

  // === FLUXO MAQUININHA (Blu / Pague Veloz Cartão) ===
  if (bancoSelecionado.tipo === "blu" || bancoSelecionado.tipo === "pague_veloz") {
    return <BluFlow banco={bancoSelecionado} onTrocar={trocarBanco} />;
  }

  // === FLUXO PIX (Pague Veloz PIX) ===
  if (bancoSelecionado.tipo === "pague_veloz_pix") {
    return <PagueVelozPixFlow banco={bancoSelecionado} onTrocar={trocarBanco} />;
  }

  // === FLUXO EXTRATO (Sicredi e similares) ===
  return <ExtratoBancarioFlow banco={bancoSelecionado} onTrocar={trocarBanco} />;
}

// ============================================================
// FLUXO: EXTRATO BANCÁRIO (Sicredi, Pague Veloz...)
// ============================================================

function ExtratoBancarioFlow({ banco, onTrocar }) {
  const [erpFile, setErpFile] = useState(null);
  const [bancoFile, setBancoFile] = useState(null);
  const [erpItems, setErpItems] = useState([]);
  const [bancoItems, setBancoItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeView, setActiveView] = useState("conciliados");
  const [searchTerm, setSearchTerm] = useState("");

  const handleErp = async (f) => {
    setError("");
    setLoading(true);
    setErpFile(f);
    try {
      const items = await readErpFile(f);
      if (!items.length) {
        setError(
          "Nenhum lançamento foi extraído do arquivo do ERP. Verifique se o formato está correto (PDF do sistema ou Excel com colunas Data, Histórico, Valor)."
        );
        setErpFile(null);
      } else {
        setErpItems(items);
      }
    } catch (e) {
      setError("Erro ao ler arquivo do ERP: " + e.message);
      setErpFile(null);
    } finally {
      setLoading(false);
    }
  };

  const handleBanco = async (f) => {
    setError("");
    setLoading(true);
    setBancoFile(f);
    try {
      const items = await readBancoFile(f, banco.id);
      if (!items.length) {
        setError(
          `Nenhum lançamento foi extraído do extrato. O parser do ${banco.nome} pode não estar lendo este formato. Tente exportar em outro formato (Excel/CSV) ou verifique se o PDF não é uma imagem escaneada.`
        );
        setBancoFile(null);
      } else {
        setBancoItems(items);
      }
    } catch (e) {
      setError("Erro ao ler extrato bancário: " + e.message);
      setBancoFile(null);
    } finally {
      setLoading(false);
    }
  };

  const result = useMemo(() => {
    if (!erpItems.length || !bancoItems.length) return null;
    return conciliarFinanceiro(erpItems, bancoItems);
  }, [erpItems, bancoItems]);

  const filtrarLista = (items, getCampos) => {
    const t = searchTerm.toLowerCase().trim();
    if (!t) return items;
    return items.filter((it) => {
      const campos = getCampos(it);
      return campos.some((c) => String(c || "").toLowerCase().includes(t));
    });
  };

  const filteredConciliados = useMemo(() => {
    if (!result) return [];
    return filtrarLista(result.conciliados, (c) => [
      c.erp.historico,
      c.banco.historico,
      c.erp.documento,
      c.banco.documento,
      c.erp.valor.toFixed(2),
    ]);
  }, [result, searchTerm]);

  const filteredSoErp = useMemo(() => {
    if (!result) return [];
    return filtrarLista(result.soNoErp, (it) => [
      it.historico,
      it.documento,
      it.valor.toFixed(2),
    ]);
  }, [result, searchTerm]);

  const filteredSoBanco = useMemo(() => {
    if (!result) return [];
    return filtrarLista(result.soNoBanco, (it) => [
      it.historico,
      it.documento,
      it.valor.toFixed(2),
    ]);
  }, [result, searchTerm]);

  const exportar = () => {
    if (!result) return;
    const hoje = new Date().toISOString().slice(0, 10);
    const wb = XLSX.utils.book_new();

    // Aba 1: Conciliados
    const rowsConciliados = result.conciliados.map((c) => ({
      "Data ERP": c.erp.dataStr,
      "Data Banco": c.banco.dataStr,
      "Diferença Dias": c.diffDias,
      Valor: c.erp.valor,
      "Histórico ERP": c.erp.historico,
      "Documento ERP": c.erp.documento,
      "Histórico Banco": c.banco.historico,
      "Documento Banco": c.banco.documento,
      Conferir: c.conferir ? "SIM" : "",
    }));
    if (rowsConciliados.length) {
      const ws1 = XLSX.utils.json_to_sheet(rowsConciliados);
      XLSX.utils.book_append_sheet(wb, ws1, "Conciliados");
    } else {
      // Cria aba vazia com cabeçalhos pra facilitar leitura
      const ws1 = XLSX.utils.aoa_to_sheet([
        ["Data ERP", "Data Banco", "Diferença Dias", "Valor", "Histórico ERP", "Documento ERP", "Histórico Banco", "Documento Banco", "Conferir"],
        ["(nenhum lançamento conciliado)"],
      ]);
      XLSX.utils.book_append_sheet(wb, ws1, "Conciliados");
    }

    // Aba 2: Só no ERP
    const rowsSoErp = result.soNoErp.map((it) => ({
      Data: it.dataStr,
      Valor: it.valor,
      Histórico: it.historico,
      Documento: it.documento,
    }));
    if (rowsSoErp.length) {
      const ws2 = XLSX.utils.json_to_sheet(rowsSoErp);
      XLSX.utils.book_append_sheet(wb, ws2, "Só no ERP");
    } else {
      const ws2 = XLSX.utils.aoa_to_sheet([
        ["Data", "Valor", "Histórico", "Documento"],
        ["(nenhuma divergência)"],
      ]);
      XLSX.utils.book_append_sheet(wb, ws2, "Só no ERP");
    }

    // Aba 3: Só no Banco
    const rowsSoBanco = result.soNoBanco.map((it) => ({
      Data: it.dataStr,
      Valor: it.valor,
      Histórico: it.historico,
      Documento: it.documento,
    }));
    if (rowsSoBanco.length) {
      const ws3 = XLSX.utils.json_to_sheet(rowsSoBanco);
      XLSX.utils.book_append_sheet(wb, ws3, "Só no Banco");
    } else {
      const ws3 = XLSX.utils.aoa_to_sheet([
        ["Data", "Valor", "Histórico", "Documento"],
        ["(nenhuma divergência)"],
      ]);
      XLSX.utils.book_append_sheet(wb, ws3, "Só no Banco");
    }

    // Aba 4: Resumo
    const totalConciliados = result.conciliados.length;
    const matchExato = result.conciliados.filter((c) => c.diffDias === 0).length;
    const matchTolerancia = result.conciliados.filter((c) => c.diffDias > 0).length;
    const conferir = result.conciliados.filter((c) => c.conferir).length;
    const wsResumo = XLSX.utils.aoa_to_sheet([
      ["RESUMO DA CONCILIAÇÃO"],
      [],
      ["Banco", banco.nome],
      ["Data da conciliação", hoje],
      [],
      ["Lançamentos no ERP", erpItems.length],
      ["Lançamentos no Banco", bancoItems.length],
      [],
      ["Conciliados (total)", totalConciliados],
      ["  Match exato (data igual)", matchExato],
      ["  Com tolerância (até " + TOLERANCIA_DIAS + " dias)", matchTolerancia],
      ["  Marcados pra conferir", conferir],
      [],
      ["Divergências (total)", result.soNoErp.length + result.soNoBanco.length],
      ["  Só no ERP", result.soNoErp.length],
      ["  Só no Banco", result.soNoBanco.length],
    ]);
    XLSX.utils.book_append_sheet(wb, wsResumo, "Resumo");

    const fileName = `conciliacao-financeira_${banco.id}_${hoje}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };

  const reset = () => {
    setErpFile(null);
    setBancoFile(null);
    setErpItems([]);
    setBancoItems([]);
    setError("");
    setSearchTerm("");
  };

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-8 border-b border-stone-200 pb-6">
        <div className="flex items-baseline gap-3 mb-2">
          <span className="text-xs uppercase tracking-[0.2em] text-red-700 font-semibold">
            Módulo 02
          </span>
          <span className="text-stone-300">—</span>
          <span className="text-xs uppercase tracking-wider text-stone-500">
            {banco.nome}
          </span>
          <button
            onClick={onTrocar}
            className="ml-2 text-xs text-red-700 hover:text-red-800 underline"
          >
            trocar banco
          </button>
        </div>
        <h1 className="font-serif text-4xl font-bold text-stone-900 tracking-tight">
          Conciliação Financeira — {banco.nome}
        </h1>
        <p className="text-stone-600 mt-2 max-w-2xl">
          Compara os lançamentos do ERP com o extrato do{" "}
          <strong>{banco.nome}</strong>.
        </p>
      </div>

      {/* Upload */}
      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <FileDropZone
          label="Lançamentos do ERP"
          sublabel="PDF do sistema ou planilha Excel"
          icon={FileSpreadsheet}
          accept=".pdf,.xlsx,.xls,.csv"
          file={erpFile}
          onFile={handleErp}
          onClear={() => {
            setErpFile(null);
            setErpItems([]);
          }}
          disabled={loading}
        />
        <FileDropZone
          label={`Extrato do ${banco.nome}`}
          sublabel="PDF, Excel ou CSV"
          icon={Landmark}
          accept=".pdf,.xlsx,.xls,.csv,.ofx"
          file={bancoFile}
          onFile={handleBanco}
          onClear={() => {
            setBancoFile(null);
            setBancoItems([]);
          }}
          disabled={loading}
        />
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-stone-600 text-sm mb-4">
          <Loader2 className="w-4 h-4 animate-spin" />
          Processando arquivo…
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-900 rounded-lg p-4 mb-4">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {result && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <StatCard
              label="ERP"
              value={erpItems.length}
              sublabel="lançamentos"
              accent="stone"
              icon={FileSpreadsheet}
            />
            <StatCard
              label={banco.nome}
              value={bancoItems.length}
              sublabel="lançamentos"
              accent="stone"
              icon={Landmark}
            />
            <StatCard
              label="Conciliados"
              value={result.conciliados.length}
              sublabel={`${
                result.conciliados.filter((c) => c.conferir).length
              } pra conferir`}
              accent="green"
              icon={CheckCircle2}
            />
            <StatCard
              label="Divergências"
              value={result.soNoErp.length + result.soNoBanco.length}
              sublabel={`${result.soNoErp.length} ERP · ${result.soNoBanco.length} banco`}
              accent="red"
              icon={AlertCircle}
            />
          </div>

          {/* Barra de ações */}
          <div className="flex flex-wrap items-center gap-3 mb-4 pb-4 border-b border-stone-200">
            <div className="flex bg-stone-100 rounded-md p-1">
              <button
                onClick={() => setActiveView("conciliados")}
                className={`px-4 py-1.5 text-sm font-medium rounded transition-colors ${
                  activeView === "conciliados"
                    ? "bg-white text-emerald-800 shadow-sm"
                    : "text-stone-600 hover:text-stone-900"
                }`}
              >
                Conciliados ({result.conciliados.length})
              </button>
              <button
                onClick={() => setActiveView("soErp")}
                className={`px-4 py-1.5 text-sm font-medium rounded transition-colors ${
                  activeView === "soErp"
                    ? "bg-white text-red-900 shadow-sm"
                    : "text-stone-600 hover:text-stone-900"
                }`}
              >
                Só no ERP ({result.soNoErp.length})
              </button>
              <button
                onClick={() => setActiveView("soBanco")}
                className={`px-4 py-1.5 text-sm font-medium rounded transition-colors ${
                  activeView === "soBanco"
                    ? "bg-white text-red-800 shadow-sm"
                    : "text-stone-600 hover:text-stone-900"
                }`}
              >
                Só no Banco ({result.soNoBanco.length})
              </button>
            </div>

            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
              <input
                type="text"
                placeholder="Buscar por valor, histórico ou documento…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm border border-stone-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-red-700/30 focus:border-red-700"
              />
            </div>

            <div className="flex gap-2 ml-auto">
              <button
                onClick={exportar}
                className="flex items-center gap-2 px-3 py-2 text-sm border border-stone-300 rounded-md bg-white hover:bg-stone-50"
                title="Baixa um Excel com 4 abas: Conciliados, Só no ERP, Só no Banco e Resumo"
              >
                <Download className="w-4 h-4" />
                Baixar Excel completo
              </button>
              <button
                onClick={reset}
                className="px-3 py-2 text-sm text-stone-600 hover:text-stone-900"
              >
                Reiniciar
              </button>
            </div>
          </div>

          {/* Listas */}
          {activeView === "conciliados" && (
            <ConciliadosFinanceirosList items={filteredConciliados} />
          )}
          {activeView === "soErp" && (
            <DivergenciaSimplesList items={filteredSoErp} cor="red" />
          )}
          {activeView === "soBanco" && (
            <DivergenciaSimplesList items={filteredSoBanco} cor="amber" />
          )}
        </>
      )}

      {!result && !loading && (erpFile || bancoFile) && (
        <div className="text-center py-12 text-stone-500 text-sm">
          Envie os dois arquivos para iniciar a conciliação.
        </div>
      )}

      {!erpFile && !bancoFile && !loading && (
        <div className="text-center py-16 bg-gradient-to-b from-red-50/40 to-transparent rounded-lg border border-stone-200">
          <CircleDollarSign className="w-10 h-10 text-red-700 mx-auto mb-3" />
          <p className="font-serif text-lg text-stone-800 mb-1">
            Pronto para conciliar
          </p>
          <p className="text-sm text-stone-600 max-w-md mx-auto">
            Envie o relatório do ERP e o extrato do {banco.nome} para
            identificar divergências, lançamentos esquecidos e diferenças de data.
          </p>
        </div>
      )}
    </div>
  );
}

// ============================================================
// FLUXO BLU (Blu SS Express e Blu Lupe)
// ============================================================

function BluFlow({ banco, onTrocar }) {
  const [bluFile, setBluFile] = useState(null);
  const [erpFile, setErpFile] = useState(null);
  const [vendasBlu, setVendasBlu] = useState([]);
  const [vendasErp, setVendasErp] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeView, setActiveView] = useState("conciliados");
  const [searchTerm, setSearchTerm] = useState("");
  const { taxas: tabelaTaxasBlu, loaded: taxasBluLoaded } = useTaxasBlu();
  const { taxas: tabelaTaxasPV, loaded: taxasPVLoaded } = useTaxasPagueVeloz();

  // Identifica se estamos no fluxo Blu (Excel) ou Pague Veloz (CSV)
  const ehPagueVeloz = banco.tipo === "pague_veloz";
  const tabelaTaxas = ehPagueVeloz ? tabelaTaxasPV : tabelaTaxasBlu;
  const taxasLoaded = ehPagueVeloz ? taxasPVLoaded : taxasBluLoaded;

  const handleBlu = async (f) => {
    setError("");
    setLoading(true);
    setBluFile(f);
    try {
      const items = ehPagueVeloz ? await readPagueVelozCsv(f) : await readBluExcel(f);
      if (!items.length) {
        setError(
          ehPagueVeloz
            ? "Nenhuma venda foi extraída do CSV da Pague Veloz. Verifique se o arquivo é o relatório de operações (relatorio-operacoes.csv)."
            : "Nenhuma venda foi extraída do Excel da Blu. Verifique se o arquivo é o extrato de vendas (extrato-vendas-completo-XXXX.xlsx)."
        );
        setBluFile(null);
      } else {
        setVendasBlu(items);
      }
    } catch (e) {
      setError(`Erro ao ler ${ehPagueVeloz ? "CSV da Pague Veloz" : "Excel da Blu"}: ` + e.message);
      setBluFile(null);
    } finally {
      setLoading(false);
    }
  };

  const handleErp = async (f) => {
    setError("");
    setLoading(true);
    setErpFile(f);
    try {
      const items = await readErpBluPdf(f, banco.secaoPdf);
      if (!items.length) {
        setError(
          `Nenhuma venda foi encontrada na seção "${banco.secaoPdf}" do PDF do ERP. ` +
          `Verifique se o relatório é "Vendas Por Finalizadores" e contém essa forma de pagamento. ` +
          `Se o relatório está correto, abra o Console do navegador (F12 → aba Console) e procure por mensagens "[BLU]" pra ver detalhes.`
        );
        setErpFile(null);
      } else {
        setVendasErp(items);
      }
    } catch (e) {
      setError("Erro ao ler PDF do ERP: " + e.message);
      setErpFile(null);
    } finally {
      setLoading(false);
    }
  };

  const result = useMemo(() => {
    if (!vendasBlu.length || !vendasErp.length) return null;
    if (!taxasLoaded) return null; // espera as taxas carregarem
    const tipoMaq = ehPagueVeloz ? "pague_veloz" : "blu";
    return conciliarBlu(vendasBlu, vendasErp, 0.01, tabelaTaxas, tipoMaq);
  }, [vendasBlu, vendasErp, tabelaTaxas, taxasLoaded, ehPagueVeloz]);

  const filtrarLista = (items, getCampos) => {
    const t = searchTerm.toLowerCase().trim();
    if (!t) return items;
    return items.filter((it) => {
      const campos = getCampos(it);
      return campos.some((c) => String(c || "").toLowerCase().includes(t));
    });
  };

  const filteredConciliados = useMemo(() => {
    if (!result) return [];
    return filtrarLista(result.conciliados, (c) => [
      c.erp.cliente,
      c.erp.numVenda,
      c.erp.numPedido,
      c.blu.autorizacao,
      c.blu.bandeira,
      c.blu.valorBrutoTotal.toFixed(2),
    ]);
  }, [result, searchTerm]);

  const filteredSoErp = useMemo(() => {
    if (!result) return [];
    return filtrarLista(result.soNoErp, (it) => [
      it.cliente,
      it.numVenda,
      it.numPedido,
      it.nsuErp,
      it.rede,
      it.valor.toFixed(2),
    ]);
  }, [result, searchTerm]);

  const filteredSoBlu = useMemo(() => {
    if (!result) return [];
    return filtrarLista(result.soNaBlu, (it) => [
      it.nsu,
      it.autorizacao,
      it.bandeira,
      it.valorBrutoTotal.toFixed(2),
    ]);
  }, [result, searchTerm]);

  const filteredCanceladas = useMemo(() => {
    if (!result) return [];
    return filtrarLista(result.canceladas, (it) => [
      it.nsu,
      it.autorizacao,
      it.status,
      it.valorBrutoTotal.toFixed(2),
    ]);
  }, [result, searchTerm]);

  const filteredTaxasFora = useMemo(() => {
    if (!result) return [];
    return filtrarLista(result.taxasForaNegociada, (x) => [
      x.erp.cliente,
      x.erp.numVenda,
      x.blu.autorizacao,
      x.blu.bandeira,
      x.blu.valorBrutoTotal.toFixed(2),
    ]);
  }, [result, searchTerm]);

  const exportar = () => {
    if (!result) return;
    const hoje = new Date().toISOString().slice(0, 10);
    const wb = XLSX.utils.book_new();

    // Aba 1: Conciliados
    const rowsConciliados = result.conciliados.map((c) => ({
      "Data Venda (Blu)": formatarData(c.blu.dataVenda),
      "Data Emissão (ERP)": c.erp.dataStr,
      "Loja": c.erp.loja,
      "Nº Venda": c.erp.numVenda,
      "Nº Pedido": c.erp.numPedido,
      "Cliente": c.erp.cliente,
      "NSU": c.blu.autorizacao,
      "ID interno Blu": c.blu.nsu,
      "Bandeira": c.blu.bandeira,
      "Tipo": c.blu.tipo,
      "Parcelas": c.blu.qtdParcelas,
      "Valor Bruto (Blu)": c.blu.valorBrutoTotal,
      "Valor Líquido (Blu)": c.blu.valorLiquidoTotal,
      "Valor (ERP)": c.erp.valor,
    }));
    if (rowsConciliados.length) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rowsConciliados), "Conciliados");
    } else {
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([["(nenhuma venda conciliada)"]]),
        "Conciliados"
      );
    }

    // Aba 2: Só no ERP
    const rowsSoErp = result.soNoErp.map((v) => ({
      "Data Emissão": v.dataStr,
      "Loja": v.loja,
      "Nº Venda": v.numVenda,
      "Nº Pedido": v.numPedido,
      "Cliente": v.cliente,
      "Rede": v.rede,
      "NSU": v.nsuErp,
      "Parcelas": v.parcelasErp,
      "Valor (ERP)": v.valor,
      "Valor (Blu)": v.candidatoBlu ? v.candidatoBlu.valorBrutoTotal : "",
      "Motivo": MOTIVOS_DIVERGENCIA[v.motivo]?.label || "",
      "Detalhe": v.motivoDetalhe || "",
    }));
    if (rowsSoErp.length) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rowsSoErp), "Só no ERP");
    } else {
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([["(nenhuma divergência)"]]),
        "Só no ERP"
      );
    }

    // Aba 3: Só na Blu
    const rowsSoBlu = result.soNaBlu.map((v) => ({
      "Data Venda": formatarData(v.dataVenda),
      "NSU": v.autorizacao,
      "ID interno Blu": v.nsu,
      "Bandeira": v.bandeira,
      "Tipo": v.tipo,
      "Parcelas": v.qtdParcelas,
      "Status": v.status,
      "Valor Bruto (Blu)": v.valorBrutoTotal,
      "Valor Líquido (Blu)": v.valorLiquidoTotal,
      "Valor (ERP)": v.candidatoErp ? v.candidatoErp.valor : "",
      "Terminal": v.terminal,
      "Motivo": MOTIVOS_DIVERGENCIA[v.motivo]?.label || "",
      "Detalhe": v.motivoDetalhe || "",
    }));
    if (rowsSoBlu.length) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rowsSoBlu), "Só na Blu");
    } else {
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([["(nenhuma divergência)"]]),
        "Só na Blu"
      );
    }

    // Aba 4: Canceladas (se houver)
    if (result.canceladas.length > 0) {
      const rowsCanc = result.canceladas.map((v) => ({
        "Data Venda": formatarData(v.dataVenda),
        "NSU": v.autorizacao,
        "ID interno Blu": v.nsu,
        "Status": v.status,
        "Bandeira": v.bandeira,
        "Valor Bruto": v.valorBrutoTotal,
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rowsCanc), "Canceladas");
    }

    // Aba: Taxas fora da negociada (se houver)
    if (result.taxasForaNegociada.length > 0) {
      const nomesTipo = Object.fromEntries(TIPOS_OPERACAO_BLU.map((t) => [t.id, t.nome]));
      const nomesGrupo = Object.fromEntries(GRUPOS_BANDEIRA_BLU.map((g) => [g.id, g.nome]));
      const rowsTaxas = result.taxasForaNegociada.map((x) => {
        const c = x.conferencia;
        const prejuizo = (c.diferenca / 100) * x.blu.valorBrutoTotal;
        return {
          "Data Venda": formatarData(x.blu.dataVenda),
          "Loja": x.erp.loja,
          "Nº Venda": x.erp.numVenda,
          "Cliente": x.erp.cliente,
          "Bandeira": x.blu.bandeira,
          "Tipo": x.blu.tipo,
          "Parcelas": x.blu.qtdParcelas,
          "Faixa Tabela": nomesTipo[c.tipoId] || "",
          "Grupo Bandeira": nomesGrupo[c.grupoId] || "",
          "Valor Bruto": x.blu.valorBrutoTotal,
          "Valor Líquido": x.blu.valorLiquidoTotal,
          "Taxa Negociada (%)": c.taxaNegociada,
          "Taxa Cobrada (%)": c.taxaCobrada,
          "Diferença (pp)": c.diferenca,
          "Prejuízo Estimado (R$)": Math.round(prejuizo * 100) / 100,
          "NSU": x.blu.autorizacao,
        };
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rowsTaxas), "Taxas fora da negociada");
    }

    // Aba: Resumo
    const totalConcil = result.conciliados.reduce((s, c) => s + c.blu.valorBrutoTotal, 0);
    const totalSoErp = result.soNoErp.reduce((s, v) => s + v.valor, 0);
    const totalSoBlu = result.soNaBlu.reduce((s, v) => s + v.valorBrutoTotal, 0);
    const totalPrejuizoTaxas = result.taxasForaNegociada.reduce(
      (s, x) => s + (x.conferencia.diferenca / 100) * x.blu.valorBrutoTotal, 0
    );
    const wsResumo = XLSX.utils.aoa_to_sheet([
      [`RESUMO DA CONCILIAÇÃO ${ehPagueVeloz ? "PAGUE VELOZ" : "BLU"}`],
      [],
      ["Maquininha", banco.nome],
      ["Data da conciliação", hoje],
      [],
      [`Vendas no ${ehPagueVeloz ? "CSV da Pague Veloz" : "Excel da Blu"}`, vendasBlu.length],
      ["Linhas no PDF do ERP", vendasErp.length],
      [],
      ["Conciliados (qtd)", result.conciliados.length],
      ["Conciliados (valor total)", totalConcil],
      [],
      ["Só no ERP (qtd)", result.soNoErp.length],
      ["Só no ERP (valor total)", totalSoErp],
      [],
      [`Só na ${ehPagueVeloz ? "Pague Veloz" : "Blu"} (qtd)`, result.soNaBlu.length],
      [`Só na ${ehPagueVeloz ? "Pague Veloz" : "Blu"} (valor total)`, totalSoBlu],
      [],
      ["Taxas fora da negociada (qtd)", result.taxasForaNegociada.length],
      ["Prejuízo estimado por taxas", Math.round(totalPrejuizoTaxas * 100) / 100],
      [],
      ["Canceladas/Estornadas (qtd)", result.canceladas.length],
    ]);
    XLSX.utils.book_append_sheet(wb, wsResumo, "Resumo");

    const fileName = `conciliacao_${banco.id}_${hoje}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };

  const reset = () => {
    setBluFile(null);
    setErpFile(null);
    setVendasBlu([]);
    setVendasErp([]);
    setError("");
    setSearchTerm("");
  };

  const totais = useMemo(() => {
    if (!result) return null;
    // Calcula o prejuízo total das taxas cobradas a mais:
    // pra cada venda com taxa "acima", o prejuízo é (diferenca% / 100) * valorBruto
    const prejuizoTaxas = result.taxasForaNegociada.reduce((s, x) => {
      const dif = x.conferencia?.diferenca || 0;
      return s + (dif / 100) * x.blu.valorBrutoTotal;
    }, 0);
    return {
      conciliados: result.conciliados.reduce((s, c) => s + c.blu.valorBrutoTotal, 0),
      soErp: result.soNoErp.reduce((s, v) => s + v.valor, 0),
      soBlu: result.soNaBlu.reduce((s, v) => s + v.valorBrutoTotal, 0),
      prejuizoTaxas,
    };
  }, [result]);

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-8 border-b border-stone-200 pb-6">
        <div className="flex items-baseline gap-3 mb-2">
          <span className="text-xs uppercase tracking-[0.2em] text-red-700 font-semibold">
            Módulo 02
          </span>
          <span className="text-stone-300">—</span>
          <span className="text-xs uppercase tracking-wider text-stone-500">
            {banco.nome}
          </span>
          <button
            onClick={onTrocar}
            className="ml-2 text-xs text-red-700 hover:text-red-800 underline"
          >
            trocar banco
          </button>
        </div>
        <h1 className="font-serif text-4xl font-bold text-stone-900 tracking-tight">
          Conciliação — {banco.nome}
        </h1>
        <p className="text-stone-600 mt-2 max-w-2xl">
          Compara as vendas registradas no <strong>ERP</strong> (forma de pagamento{" "}
          <strong>{banco.secaoPdf}</strong>) com o extrato de vendas da{" "}
          <strong>{ehPagueVeloz ? "maquininha Pague Veloz" : "maquininha Blu"}</strong>.
          O match é feito pelo NSU do cartão.
        </p>
      </div>

      {/* Passo-a-passo: como tirar o extrato (apenas Pague Veloz) */}
      {ehPagueVeloz && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <div className="flex items-start gap-3 mb-3">
            <AlertCircle className="w-5 h-5 text-blue-700 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="font-serif text-base font-semibold text-blue-900">
                Como tirar o CSV da Pague Veloz
              </h3>
              <p className="text-xs text-blue-800 mt-0.5">
                Siga os passos abaixo para baixar o relatório de operações.
              </p>
            </div>
          </div>

          <ol className="space-y-2.5 text-sm text-blue-900 ml-1">
            <li className="flex gap-2">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-700 text-white text-xs font-bold flex items-center justify-center">1</span>
              <div className="flex-1">
                Acesse{" "}
                <a
                  href="https://www.pagueveloz.com.br/conta/maquininha/relatorios/operacoes/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-700 underline hover:text-blue-900 font-mono text-xs break-all"
                >
                  pagueveloz.com.br/conta/maquininha/relatorios/operacoes
                </a>
              </div>
            </li>
            <li className="flex gap-2">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-700 text-white text-xs font-bold flex items-center justify-center">2</span>
              <div className="flex-1">
                Faça login com o e-mail{" "}
                <code className="bg-white border border-blue-200 px-1.5 py-0.5 rounded font-mono text-xs">sacsofashow@gmail.com</code>
                {" "}e a senha da conta
              </div>
            </li>
            <li className="flex gap-2">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-700 text-white text-xs font-bold flex items-center justify-center">3</span>
              <div className="flex-1">
                Clique na aba <strong>Maquininha</strong> e depois em <strong>Relatórios de Operações</strong>
              </div>
            </li>
            <li className="flex gap-2">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-700 text-white text-xs font-bold flex items-center justify-center">4</span>
              <div className="flex-1">
                No campo <strong>Status</strong>, selecione <strong>Pago</strong>
              </div>
            </li>
            <li className="flex gap-2">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-700 text-white text-xs font-bold flex items-center justify-center">5</span>
              <div className="flex-1">
                Clique em <strong>Buscar</strong> e depois em <strong>Exportar CSV</strong>
              </div>
            </li>
            <li className="flex gap-2">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-700 text-white text-xs font-bold flex items-center justify-center">6</span>
              <div className="flex-1">
                Volte aqui e envie o arquivo no campo <strong>CSV da Pague Veloz</strong> abaixo
              </div>
            </li>
          </ol>
        </div>
      )}

      {/* Como tirar o PDF do ERP - aparece sempre (Blu e PV) */}
      <ComoTirarRelatorioErp />

      {/* Upload */}
      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <FileDropZone
          label={ehPagueVeloz ? "CSV da Pague Veloz" : "Excel da Blu"}
          sublabel={ehPagueVeloz ? "relatorio-operacoes.csv" : "extrato-vendas-completo-XXXX.xlsx"}
          icon={CreditCard}
          accept={ehPagueVeloz ? ".csv,.txt" : ".xlsx,.xls"}
          file={bluFile}
          onFile={handleBlu}
          onClear={() => {
            setBluFile(null);
            setVendasBlu([]);
          }}
          disabled={loading}
        />
        <FileDropZone
          label="PDF do ERP"
          sublabel="Relatório de Vendas Por Finalizadores"
          icon={FileText}
          accept=".pdf"
          file={erpFile}
          onFile={handleErp}
          onClear={() => {
            setErpFile(null);
            setVendasErp([]);
          }}
          disabled={loading}
        />
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-stone-600 text-sm mb-4">
          <Loader2 className="w-4 h-4 animate-spin" />
          Processando arquivo…
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-900 rounded-lg p-4 mb-4">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {result && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
            <StatCard
              label="Conciliados"
              value={result.conciliados.length}
              sublabel={formatarMoeda(totais.conciliados)}
              accent="green"
              icon={CheckCircle2}
            />
            <StatCard
              label="Só no ERP"
              value={result.soNoErp.length}
              sublabel={formatarMoeda(totais.soErp)}
              accent="red"
              icon={XCircle}
            />
            <StatCard
              label={ehPagueVeloz ? "Só na Pague Veloz" : "Só na Blu"}
              value={result.soNaBlu.length}
              sublabel={formatarMoeda(totais.soBlu)}
              accent="amber"
              icon={AlertCircle}
            />
            <StatCard
              label="Taxas fora da negociada"
              value={result.taxasForaNegociada.length}
              sublabel={result.taxasForaNegociada.length > 0
                ? `prejuízo ~${formatarMoeda(totais.prejuizoTaxas)}`
                : "todas as taxas dentro do acordado"}
              accent="orange"
              icon={AlertCircle}
            />
            <StatCard
              label="Canceladas"
              value={result.canceladas.length}
              sublabel="estornadas/canceladas"
              accent="stone"
              icon={AlertTriangle}
            />
          </div>

          {/* Barra de ações */}
          <div className="flex flex-wrap items-center gap-3 mb-4 pb-4 border-b border-stone-200">
            <div className="flex bg-stone-100 rounded-md p-1 flex-wrap">
              <button
                onClick={() => setActiveView("conciliados")}
                className={`px-4 py-1.5 text-sm font-medium rounded transition-colors ${
                  activeView === "conciliados"
                    ? "bg-white text-emerald-800 shadow-sm"
                    : "text-stone-600 hover:text-stone-900"
                }`}
              >
                Conciliados ({result.conciliados.length})
              </button>
              <button
                onClick={() => setActiveView("soErp")}
                className={`px-4 py-1.5 text-sm font-medium rounded transition-colors ${
                  activeView === "soErp"
                    ? "bg-white text-red-900 shadow-sm"
                    : "text-stone-600 hover:text-stone-900"
                }`}
              >
                Só no ERP ({result.soNoErp.length})
              </button>
              <button
                onClick={() => setActiveView("soBlu")}
                className={`px-4 py-1.5 text-sm font-medium rounded transition-colors ${
                  activeView === "soBlu"
                    ? "bg-white text-red-800 shadow-sm"
                    : "text-stone-600 hover:text-stone-900"
                }`}
              >
                {ehPagueVeloz ? "Só na Pague Veloz" : "Só na Blu"} ({result.soNaBlu.length})
              </button>
              {result.taxasForaNegociada.length > 0 && (
                <button
                  onClick={() => setActiveView("taxasFora")}
                  className={`px-4 py-1.5 text-sm font-medium rounded transition-colors ${
                    activeView === "taxasFora"
                      ? "bg-white text-orange-900 shadow-sm"
                      : "text-stone-600 hover:text-stone-900"
                  }`}
                >
                  Taxas fora da negociada ({result.taxasForaNegociada.length})
                </button>
              )}
              {result.canceladas.length > 0 && (
                <button
                  onClick={() => setActiveView("canceladas")}
                  className={`px-4 py-1.5 text-sm font-medium rounded transition-colors ${
                    activeView === "canceladas"
                      ? "bg-white text-stone-800 shadow-sm"
                      : "text-stone-600 hover:text-stone-900"
                  }`}
                >
                  Canceladas ({result.canceladas.length})
                </button>
              )}
            </div>

            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
              <input
                type="text"
                placeholder="Buscar por cliente, NSU, valor…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm border border-stone-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-red-700/30 focus:border-red-700"
              />
            </div>

            <div className="flex gap-2 ml-auto">
              <button
                onClick={exportar}
                className="flex items-center gap-2 px-3 py-2 text-sm border border-stone-300 rounded-md bg-white hover:bg-stone-50"
                title="Excel com Conciliados, Só no ERP, Só na Blu, Canceladas e Resumo"
              >
                <Download className="w-4 h-4" />
                Baixar Excel completo
              </button>
              <button
                onClick={reset}
                className="px-3 py-2 text-sm text-stone-600 hover:text-stone-900"
              >
                Reiniciar
              </button>
            </div>
          </div>

          {/* Listas */}
          {activeView === "conciliados" && (
            <BluConciliadosList items={filteredConciliados} />
          )}
          {activeView === "soErp" && (
            <BluSoErpList items={filteredSoErp} />
          )}
          {activeView === "soBlu" && (
            <BluSoBluList items={filteredSoBlu} />
          )}
          {activeView === "taxasFora" && (
            <BluTaxasForaList
              items={filteredTaxasFora}
              tabelaTaxas={tabelaTaxas}
              tipoMaquininha={ehPagueVeloz ? "pague_veloz" : "blu"}
            />
          )}
          {activeView === "canceladas" && (
            <BluSoBluList items={filteredCanceladas} canceladas />
          )}
        </>
      )}

      {!result && !loading && (bluFile || erpFile) && (
        <div className="text-center py-12 text-stone-500 text-sm">
          Envie os dois arquivos para iniciar a conciliação.
        </div>
      )}

      {!bluFile && !erpFile && !loading && (
        <div className="text-center py-16 bg-gradient-to-b from-purple-50/40 to-transparent rounded-lg border border-stone-200">
          <CreditCard className="w-10 h-10 text-purple-700 mx-auto mb-3" />
          <p className="font-serif text-lg text-stone-800 mb-1">
            Pronto para conciliar
          </p>
          <p className="text-sm text-stone-600 max-w-md mx-auto">
            Envie o Excel da {banco.nome} e o PDF do ERP (Vendas Por Finalizadores)
            para identificar vendas esquecidas, divergências de valor e cancelamentos.
          </p>
        </div>
      )}
    </div>
  );
}

// ============================================================
// FLUXO: PAGUE VELOZ PIX
// Conciliação simples por VALOR + MÊS, sem usar NSU nem nome do cliente.
// Lê o extrato (relatorio-extrato.csv) e filtra só "Pix Recebido".
// ============================================================

function PagueVelozPixFlow({ banco, onTrocar }) {
  const [extratoFile, setExtratoFile] = useState(null);
  const [erpFile, setErpFile] = useState(null);
  const [pixRecebidos, setPixRecebidos] = useState([]);
  const [vendasErp, setVendasErp] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeView, setActiveView] = useState("conciliados");
  const [searchTerm, setSearchTerm] = useState("");

  const handleExtrato = async (f) => {
    setError("");
    setLoading(true);
    setExtratoFile(f);
    try {
      const items = await readPagueVelozExtratoPix(f);
      if (!items.length) {
        setError(
          `Nenhum PIX Recebido foi encontrado no extrato. Verifique se o arquivo é o "relatorio-extrato.csv" ` +
          `e contém movimentações do tipo "Pix Recebido".`
        );
        setExtratoFile(null);
      } else {
        setPixRecebidos(items);
      }
    } catch (e) {
      setError("Erro ao ler extrato da Pague Veloz: " + e.message);
      setExtratoFile(null);
    } finally {
      setLoading(false);
    }
  };

  const handleErp = async (f) => {
    setError("");
    setLoading(true);
    setErpFile(f);
    try {
      const items = await readErpBluPdf(f, banco.secaoPdf);
      if (!items.length) {
        setError(
          `Nenhuma venda foi encontrada na seção "${banco.secaoPdf}" do PDF do ERP. ` +
          `Verifique se o relatório é "Vendas Por Finalizadores" e contém essa forma de pagamento.`
        );
        setErpFile(null);
      } else {
        setVendasErp(items);
      }
    } catch (e) {
      setError("Erro ao ler PDF do ERP: " + e.message);
      setErpFile(null);
    } finally {
      setLoading(false);
    }
  };

  const result = useMemo(() => {
    if (!pixRecebidos.length || !vendasErp.length) return null;
    return conciliarPixPagueVeloz(vendasErp, pixRecebidos);
  }, [pixRecebidos, vendasErp]);

  const totais = useMemo(() => {
    if (!result) return null;
    return {
      conciliados: result.conciliados.reduce((s, c) => s + c.erp.valor, 0),
      soNoErp: result.soNoErp.reduce((s, v) => s + v.valor, 0),
      soNoExtrato: result.soNoExtrato.reduce((s, p) => s + p.valor, 0),
    };
  }, [result]);

  // Filtros de busca
  const filtrar = (items, getter) => {
    const t = searchTerm.toLowerCase().trim();
    if (!t) return items;
    return items.filter((it) =>
      getter(it).some((c) => String(c || "").toLowerCase().includes(t))
    );
  };
  const filteredConciliados = useMemo(() => {
    if (!result) return [];
    return filtrar(result.conciliados, (c) => [
      c.erp.cliente, c.erp.numVenda, c.erp.valor.toFixed(2), c.pix.pagante,
    ]);
  }, [result, searchTerm]);
  const filteredSoNoErp = useMemo(() => {
    if (!result) return [];
    return filtrar(result.soNoErp, (v) => [
      v.cliente, v.numVenda, v.valor.toFixed(2),
    ]);
  }, [result, searchTerm]);
  const filteredSoNoExtrato = useMemo(() => {
    if (!result) return [];
    return filtrar(result.soNoExtrato, (p) => [
      p.pagante, p.valor.toFixed(2),
    ]);
  }, [result, searchTerm]);

  // Exportar Excel
  const exportar = () => {
    if (!result) return;
    const hoje = new Date().toISOString().slice(0, 10);
    const wb = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      result.conciliados.map((c) => ({
        "Data Venda (ERP)": c.erp.dataStr,
        "Loja": c.erp.loja,
        "Nº Venda": c.erp.numVenda,
        "Cliente (ERP)": c.erp.cliente,
        "Valor (ERP)": c.erp.valor,
        "Data PIX (Extrato)": formatarData(c.pix.dataPix),
        "Pagante (Extrato)": c.pix.pagante,
        "Valor (Extrato)": c.pix.valor,
      }))
    ), "Conciliados");

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      result.soNoErp.map((v) => ({
        "Data": v.dataStr,
        "Loja": v.loja,
        "Nº Venda": v.numVenda,
        "Cliente": v.cliente,
        "Valor": v.valor,
        "Motivo": v.motivoDetalhe,
      }))
    ), "Só no ERP");

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      result.soNoExtrato.map((p) => ({
        "Data": formatarData(p.dataPix),
        "Pagante": p.pagante,
        "Valor": p.valor,
        "Motivo": p.motivoDetalhe,
      }))
    ), "Só no extrato PV");

    const wsResumo = XLSX.utils.aoa_to_sheet([
      ["RESUMO DA CONCILIAÇÃO PIX PAGUE VELOZ"],
      [],
      ["Conta", banco.nome],
      ["Seção do ERP", banco.secaoPdf],
      ["Data da conciliação", hoje],
      [],
      ["PIX Recebidos no extrato", pixRecebidos.length],
      ["Linhas no PDF do ERP", vendasErp.length],
      [],
      ["Conciliados (qtd)", result.conciliados.length],
      ["Conciliados (valor total)", totais.conciliados],
      [],
      ["Só no ERP (qtd)", result.soNoErp.length],
      ["Só no ERP (valor total)", totais.soNoErp],
      [],
      ["Só no extrato PV (qtd)", result.soNoExtrato.length],
      ["Só no extrato PV (valor total)", totais.soNoExtrato],
    ]);
    XLSX.utils.book_append_sheet(wb, wsResumo, "Resumo");

    XLSX.writeFile(wb, `Conciliacao-PIX-PagueVeloz-${hoje}.xlsx`);
  };

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-8 border-b border-stone-200 pb-6">
        <div className="flex items-baseline gap-3 mb-2">
          <button
            onClick={onTrocar}
            className="text-xs uppercase tracking-[0.2em] text-red-700 font-semibold hover:text-red-800 flex items-center gap-1"
          >
            <ChevronLeft className="w-3 h-3" />
            Trocar conta
          </button>
          <span className="text-stone-300">—</span>
          <span className="text-xs uppercase tracking-wider text-stone-500">
            Conciliação Financeira
          </span>
        </div>
        <h1 className="font-serif text-4xl font-bold text-stone-900 tracking-tight">
          Conciliação — {banco.nome}
        </h1>
        <p className="text-stone-600 mt-2 max-w-2xl">
          Compara as vendas registradas no <strong>ERP</strong> (forma de pagamento{" "}
          <strong>{banco.secaoPdf}</strong>) com os <strong>PIX recebidos</strong> no
          extrato da Pague Veloz. O match é feito por <strong>valor + mês</strong>{" "}
          (sem usar NSU ou nome do cliente).
        </p>
      </div>

      {/* Passo-a-passo: como tirar o extrato PIX */}
      <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-6">
        <div className="flex items-start gap-3 mb-3">
          <AlertCircle className="w-5 h-5 text-purple-700 mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="font-serif text-base font-semibold text-purple-900">
              Como tirar o relatório de PIX da Pague Veloz
            </h3>
            <p className="text-xs text-purple-800 mt-0.5">
              Siga os passos abaixo para baixar o extrato da conta com os PIX recebidos.
            </p>
          </div>
        </div>

        <ol className="space-y-2.5 text-sm text-purple-900 ml-1">
          <li className="flex gap-2">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-purple-700 text-white text-xs font-bold flex items-center justify-center">1</span>
            <div className="flex-1">
              Acesse{" "}
              <a
                href="https://www.pagueveloz.com.br/conta/consultas/extrato/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-purple-700 underline hover:text-purple-900 font-mono text-xs break-all"
              >
                pagueveloz.com.br/conta/consultas/extrato
              </a>
            </div>
          </li>
          <li className="flex gap-2">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-purple-700 text-white text-xs font-bold flex items-center justify-center">2</span>
            <div className="flex-1">
              Faça login com o e-mail{" "}
              <code className="bg-white border border-purple-200 px-1.5 py-0.5 rounded font-mono text-xs">sacsofashow@gmail.com</code>
              {" "}e a senha da conta
            </div>
          </li>
          <li className="flex gap-2">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-purple-700 text-white text-xs font-bold flex items-center justify-center">3</span>
            <div className="flex-1">
              Clique na aba <strong>Consultas</strong>
            </div>
          </li>
          <li className="flex gap-2">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-purple-700 text-white text-xs font-bold flex items-center justify-center">4</span>
            <div className="flex-1">
              Informe o <strong>período</strong> que você quer conciliar
            </div>
          </li>
          <li className="flex gap-2">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-purple-700 text-white text-xs font-bold flex items-center justify-center">5</span>
            <div className="flex-1">
              Clique em <strong>Exportar CSV</strong>
            </div>
          </li>
          <li className="flex gap-2">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-purple-700 text-white text-xs font-bold flex items-center justify-center">6</span>
            <div className="flex-1">
              Volte aqui e envie o arquivo no campo <strong>Extrato da Pague Veloz</strong> abaixo.
              O app vai filtrar automaticamente só os PIX recebidos.
            </div>
          </li>
        </ol>
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <FileDropZone
          label="Extrato da Pague Veloz"
          sublabel="relatorio-extrato.csv"
          icon={Landmark}
          accept=".csv,.txt"
          file={extratoFile}
          onFile={handleExtrato}
          onClear={() => {
            setExtratoFile(null);
            setPixRecebidos([]);
          }}
          disabled={loading}
        />
        <FileDropZone
          label="PDF do ERP (Vendas Por Finalizadores)"
          sublabel="relatório do sistema"
          icon={FileText}
          accept=".pdf"
          file={erpFile}
          onFile={handleErp}
          onClear={() => {
            setErpFile(null);
            setVendasErp([]);
          }}
          disabled={loading}
        />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 flex items-start gap-3">
          <XCircle className="w-5 h-5 text-red-700 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-900">{error}</p>
        </div>
      )}

      {result && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
            <StatCard
              label="Conciliados"
              value={result.conciliados.length}
              sublabel={formatarMoeda(totais.conciliados)}
              accent="green"
              icon={CheckCircle2}
            />
            <StatCard
              label="Só no ERP"
              value={result.soNoErp.length}
              sublabel={formatarMoeda(totais.soNoErp)}
              accent="orange"
              icon={AlertCircle}
            />
            <StatCard
              label="Só no extrato PV"
              value={result.soNoExtrato.length}
              sublabel={formatarMoeda(totais.soNoExtrato)}
              accent="amber"
              icon={AlertTriangle}
            />
          </div>

          {/* Barra de busca + exportar */}
          <div className="flex items-center gap-2 mb-4">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar por cliente, valor, pagante…"
                className="w-full pl-9 pr-3 py-2 text-sm border border-stone-300 rounded bg-white focus:outline-none focus:ring-2 focus:ring-red-700/30 focus:border-red-700"
              />
            </div>
            <button
              onClick={exportar}
              className="flex items-center gap-1.5 px-3 py-2 text-sm bg-emerald-700 text-white font-medium rounded hover:bg-emerald-800"
            >
              <Download className="w-4 h-4" />
              Excel
            </button>
          </div>

          {/* Abas */}
          <div className="bg-stone-100 p-1 rounded-md inline-flex gap-1 mb-4 flex-wrap">
            <button
              onClick={() => setActiveView("conciliados")}
              className={`px-4 py-1.5 text-sm font-medium rounded transition-colors ${
                activeView === "conciliados"
                  ? "bg-white text-emerald-800 shadow-sm"
                  : "text-stone-600 hover:text-stone-900"
              }`}
            >
              Conciliados ({result.conciliados.length})
            </button>
            <button
              onClick={() => setActiveView("soNoErp")}
              className={`px-4 py-1.5 text-sm font-medium rounded transition-colors ${
                activeView === "soNoErp"
                  ? "bg-white text-orange-800 shadow-sm"
                  : "text-stone-600 hover:text-stone-900"
              }`}
            >
              Só no ERP ({result.soNoErp.length})
            </button>
            <button
              onClick={() => setActiveView("soNoExtrato")}
              className={`px-4 py-1.5 text-sm font-medium rounded transition-colors ${
                activeView === "soNoExtrato"
                  ? "bg-white text-red-800 shadow-sm"
                  : "text-stone-600 hover:text-stone-900"
              }`}
            >
              Só no extrato PV ({result.soNoExtrato.length})
            </button>
          </div>

          {activeView === "conciliados" && (
            <PixConciliadosList items={filteredConciliados} />
          )}
          {activeView === "soNoErp" && (
            <PixSoNoErpList items={filteredSoNoErp} />
          )}
          {activeView === "soNoExtrato" && (
            <PixSoNoExtratoList items={filteredSoNoExtrato} />
          )}
        </>
      )}

      {!extratoFile && !erpFile && !loading && (
        <div className="text-center py-16 bg-gradient-to-b from-blue-50/40 to-transparent rounded-lg border border-stone-200">
          <Landmark className="w-10 h-10 text-blue-700 mx-auto mb-3" />
          <p className="font-serif text-lg text-stone-800 mb-1">
            Pronto para conciliar PIX
          </p>
          <p className="text-sm text-stone-600 max-w-md mx-auto">
            Envie o extrato da Pague Veloz (relatorio-extrato.csv) e o PDF do ERP.
            O app vai filtrar só os PIX Recebidos e cruzar com a seção PIX VELOZ EXPRES.
          </p>
        </div>
      )}
    </div>
  );
}

// Cards das listas do fluxo PIX
function PixConciliadosList({ items }) {
  if (!items.length) {
    return (
      <div className="text-center py-12 text-stone-500 text-sm">
        Nenhuma venda conciliada ainda.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {items.map((c, i) => (
        <div key={i} className="border border-emerald-200 bg-white rounded-lg p-4">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-md bg-emerald-100 flex items-center justify-center flex-shrink-0">
              <CheckCircle2 className="w-5 h-5 text-emerald-700" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 mb-1 flex-wrap">
                <span className="text-xs font-mono text-stone-500">{c.erp.dataStr}</span>
                <span className="text-[10px] uppercase tracking-wider bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded font-semibold">
                  Conciliado
                </span>
              </div>
              <h3 className="font-serif font-semibold text-stone-900 truncate">
                {c.erp.cliente}
              </h3>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-600 mt-1">
                <span>Loja: <strong className="text-stone-900">{c.erp.loja}</strong></span>
                <span>Nº Venda: <strong className="text-stone-900">{c.erp.numVenda}</strong></span>
                <span>PIX recebido em: <strong className="text-stone-900">{formatarData(c.pix.dataPix)}</strong></span>
                <span>Pagante: <strong className="text-stone-900">{c.pix.pagante}</strong></span>
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="font-serif text-xl font-bold text-emerald-800">
                {formatarMoeda(c.erp.valor)}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function PixSoNoErpList({ items }) {
  if (!items.length) {
    return (
      <div className="text-center py-12">
        <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto mb-3" />
        <p className="font-serif text-lg text-stone-800">
          Todas as vendas do ERP têm PIX correspondente
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="bg-orange-50 border border-orange-300 rounded-lg p-3 mb-3 flex items-start gap-2">
        <AlertCircle className="w-4 h-4 text-orange-700 mt-0.5 flex-shrink-0" />
        <div className="text-xs text-orange-900">
          <p className="font-semibold mb-1">Vendas no ERP sem PIX correspondente no extrato.</p>
          <p>O valor lançado pode estar errado, ou o PIX foi para outra conta — confira no ERP.</p>
        </div>
      </div>

      {items.map((v, i) => (
        <div key={i} className="border border-orange-300 bg-white rounded-lg p-4">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-md bg-orange-100 flex items-center justify-center flex-shrink-0">
              <AlertCircle className="w-5 h-5 text-orange-700" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 mb-1 flex-wrap">
                <span className="text-xs font-mono text-stone-500">{v.dataStr}</span>
                <span className="text-[10px] uppercase tracking-wider bg-orange-100 text-orange-900 px-1.5 py-0.5 rounded font-semibold border border-orange-300">
                  Sem PIX correspondente
                </span>
              </div>
              <h3 className="font-serif font-semibold text-stone-900 truncate">
                {v.cliente}
              </h3>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-600 mt-1">
                <span>Loja: <strong className="text-stone-900">{v.loja}</strong></span>
                <span>Nº Venda: <strong className="text-stone-900">{v.numVenda}</strong></span>
                <span>Pedido: <strong className="text-stone-900">{v.numPedido}</strong></span>
              </div>
              <div className="mt-2 text-xs px-3 py-2 rounded border bg-orange-50 border-orange-200 text-orange-900">
                <strong>Motivo:</strong> {v.motivoDetalhe}
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="font-serif text-xl font-bold text-orange-700">
                {formatarMoeda(v.valor)}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function PixSoNoExtratoList({ items }) {
  if (!items.length) {
    return (
      <div className="text-center py-12">
        <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto mb-3" />
        <p className="font-serif text-lg text-stone-800">
          Todos os PIX recebidos foram conciliados
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-3 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-red-700 mt-0.5 flex-shrink-0" />
        <div className="text-xs text-red-800">
          <p className="font-semibold mb-1">PIX recebidos na Pague Veloz sem venda correspondente no ERP.</p>
          <p>Pode ser PIX VELOZ VPP ou PIX VELOZ SS (não Express), ou venda esquecida no sistema.</p>
        </div>
      </div>

      {items.map((p, i) => (
        <div key={i} className="border border-red-200 bg-white rounded-lg p-4">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-md bg-red-100 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-5 h-5 text-red-700" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 mb-1 flex-wrap">
                <span className="text-xs font-mono text-stone-500">{formatarData(p.dataPix)}</span>
                <span className="text-[10px] uppercase tracking-wider bg-red-100 text-red-800 px-1.5 py-0.5 rounded font-semibold border border-red-300">
                  PIX sem correspondente
                </span>
              </div>
              <h3 className="font-serif font-semibold text-stone-900 truncate">
                {p.pagante || "(sem pagante informado)"}
              </h3>
              <div className="mt-2 text-xs px-3 py-2 rounded border bg-red-50 border-red-200 text-red-800">
                <strong>Motivo:</strong> {p.motivoDetalhe}
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="font-serif text-xl font-bold text-red-700">
                {formatarMoeda(p.valor)}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function BluConciliadosList({ items }) {
  if (!items.length) {
    return (
      <div className="text-center py-12 text-stone-500 text-sm">
        Nenhuma venda conciliada ainda.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((c, i) => (
        <div key={i} className="border border-emerald-200 bg-white rounded-lg p-4">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-md bg-emerald-100 flex items-center justify-center flex-shrink-0">
              <CheckCircle2 className="w-5 h-5 text-emerald-700" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 mb-1 flex-wrap">
                <span className="text-xs font-mono text-stone-500">
                  {c.erp.dataStr}
                </span>
                <span className="text-[10px] uppercase tracking-wider bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded font-semibold">
                  {c.blu.bandeira}
                </span>
                <span className="text-[10px] uppercase tracking-wider bg-stone-100 text-stone-600 px-1.5 py-0.5 rounded">
                  {c.blu.qtdParcelas}x {c.blu.tipo}
                </span>
              </div>
              <h3 className="font-serif font-semibold text-stone-900 truncate">
                {c.erp.cliente}
              </h3>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-600 mt-1">
                <span>
                  Loja: <strong className="text-stone-900">{c.erp.loja}</strong>
                </span>
                <span>
                  Nº Venda: <strong className="text-stone-900">{c.erp.numVenda}</strong>
                </span>
                <span>
                  Pedido: <strong className="text-stone-900">{c.erp.numPedido}</strong>
                </span>
                <span>
                  NSU: <strong className="font-mono text-stone-900">{c.blu.autorizacao}</strong>
                </span>
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="font-serif text-xl font-bold text-emerald-700">
                {formatarMoeda(c.blu.valorBrutoTotal)}
              </p>
              <p className="text-xs text-stone-500 mt-0.5">
                Líquido: {formatarMoeda(c.blu.valorLiquidoTotal)}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// Mapa de motivos para visual e texto curto
const MOTIVOS_DIVERGENCIA = {
  sem_nsu: {
    label: "NSU não está no extrato",
    cor: "orange",
    explicacao: "O NSU desta venda não foi encontrado no extrato da maquininha — pode ter sido passado em outra maquininha.",
  },
  sem_no_erp: {
    label: "Sem correspondente no ERP",
    cor: "red",
    explicacao: "Esta venda do extrato da maquininha não aparece no PDF do ERP.",
  },
  nsu_divergente: {
    label: "NSU divergente nos dois arquivos",
    cor: "purple",
    explicacao: "O valor e o mês batem, mas o NSU foi registrado diferente entre ERP e o extrato da maquininha (provável erro de digitação).",
  },
  valor_diferente: {
    label: "Divergência de valor",
    cor: "red",
    explicacao: "O NSU e o mês batem, mas o valor é diferente.",
  },
  mes_diferente: {
    label: "Divergência de mês",
    cor: "amber",
    explicacao: "O NSU e o valor batem, mas a venda foi em outro mês.",
  },
  valor_e_mes_diferentes: {
    label: "Valor e mês diferentes",
    cor: "amber",
    explicacao: "O NSU bate, mas tanto o valor quanto o mês são diferentes.",
  },
};

function MotivoBadge({ motivo }) {
  const info = MOTIVOS_DIVERGENCIA[motivo];
  if (!info) return null;
  const cores = {
    red: "bg-red-100 text-red-800 border-red-200",
    amber: "bg-red-100 text-red-800 border-red-300",
    orange: "bg-orange-100 text-orange-900 border-orange-300",
    purple: "bg-purple-100 text-purple-900 border-purple-300",
  };
  return (
    <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-semibold border ${cores[info.cor]}`}>
      {info.label}
    </span>
  );
}

function BluSoErpList({ items }) {
  if (!items.length) {
    return (
      <div className="text-center py-12">
        <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto mb-3" />
        <p className="font-serif text-lg text-stone-800">Nenhuma venda só no ERP</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-3 flex items-start gap-2">
        <XCircle className="w-4 h-4 text-red-700 mt-0.5 flex-shrink-0" />
        <div className="text-xs text-red-900">
          <p className="font-semibold mb-1">Vendas registradas no ERP que não fecharam com a Blu.</p>
          <p>Cada venda mostra o motivo da divergência: NSU divergente nos dois arquivos, NSU não encontrado, valor diferente ou mês diferente.</p>
        </div>
      </div>

      {items.map((v, i) => {
        const info = MOTIVOS_DIVERGENCIA[v.motivo] || MOTIVOS_DIVERGENCIA.sem_nsu;
        // Paletas: red (cr\u00edtico), amber (aten\u00e7\u00e3o), orange (sem NSU - poss\u00edvel outra maquininha), purple (NSU divergente)
        const paletas = {
          red: { borda: "border-red-200", bg: "bg-red-100", icone: "text-red-700", valor: "text-red-700", caixa: "bg-red-50 border-red-200 text-red-900" },
          amber: { borda: "border-red-200", bg: "bg-red-100", icone: "text-red-700", valor: "text-red-700", caixa: "bg-red-50 border-red-200 text-red-800" },
          orange: { borda: "border-orange-300", bg: "bg-orange-100", icone: "text-orange-700", valor: "text-orange-700", caixa: "bg-orange-50 border-orange-200 text-orange-900" },
          purple: { borda: "border-purple-300", bg: "bg-purple-100", icone: "text-purple-700", valor: "text-purple-700", caixa: "bg-purple-50 border-purple-200 text-purple-900" },
        };
        const p = paletas[info.cor] || paletas.red;
        const Icone = info.cor === "red" ? XCircle : AlertCircle;

        return (
          <div key={i} className={`border ${p.borda} bg-white rounded-lg p-4`}>
            <div className="flex items-start gap-4">
              <div className={`w-10 h-10 rounded-md ${p.bg} flex items-center justify-center flex-shrink-0`}>
                <Icone className={`w-5 h-5 ${p.icone}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 mb-1 flex-wrap">
                  <span className="text-xs font-mono text-stone-500">{v.dataStr}</span>
                  <span className="text-[10px] uppercase tracking-wider bg-stone-100 text-stone-700 px-1.5 py-0.5 rounded font-semibold">
                    {v.rede}
                  </span>
                  <MotivoBadge motivo={v.motivo} />
                </div>
                <h3 className="font-serif font-semibold text-stone-900 truncate">
                  {v.cliente}
                </h3>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-600 mt-1">
                  <span>Loja: <strong className="text-stone-900">{v.loja}</strong></span>
                  <span>Nº Venda: <strong className="text-stone-900">{v.numVenda}</strong></span>
                  <span>Pedido: <strong className="text-stone-900">{v.numPedido}</strong></span>
                  <span>NSU: <strong className="font-mono text-stone-900">{v.nsuErp}</strong></span>
                  <span>Parc: <strong className="text-stone-900">{v.parcelasErp}x</strong></span>
                </div>
                {v.motivoDetalhe && (
                  <div className={`mt-2 text-xs px-3 py-2 rounded border ${p.caixa}`}>
                    <strong>Motivo:</strong> {v.motivoDetalhe}
                  </div>
                )}
              </div>
              <div className="text-right flex-shrink-0">
                <p className={`font-serif text-xl font-bold ${p.valor}`}>
                  {formatarMoeda(v.valor)}
                </p>
                {v.candidatoBlu && (
                  <p className="text-xs text-stone-500 mt-0.5">
                    Blu: {formatarMoeda(v.candidatoBlu.valorBrutoTotal)}
                    {v.motivo === "nsu_divergente" && (
                      <span className="block">NSU Blu: <span className="font-mono">{v.candidatoBlu.autorizacao}</span></span>
                    )}
                  </p>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BluSoBluList({ items, canceladas = false, nomeMaquininha = "Blu" }) {
  if (!items.length) {
    return (
      <div className="text-center py-12">
        <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto mb-3" />
        <p className="font-serif text-lg text-stone-800">
          {canceladas ? "Nenhuma venda cancelada" : `Nenhuma venda só na ${nomeMaquininha}`}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {!canceladas && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-3 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-700 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-red-800">
            <p className="font-semibold mb-1">Vendas na {nomeMaquininha} que não foram lançadas no ERP.</p>
            <p>Cada venda mostra o motivo da divergência: NSU divergente nos dois arquivos, sem correspondente no ERP, valor diferente ou mês diferente.</p>
          </div>
        </div>
      )}

      {items.map((v, i) => {
        // Para canceladas: cor stone fixa. Para divergências: cor depende do motivo.
        const paletas = {
          red: { borda: "border-red-200", bg: "bg-red-100", icone: "text-red-700", valor: "text-red-700", caixa: "bg-red-50 border-red-200 text-red-900" },
          amber: { borda: "border-red-200", bg: "bg-red-100", icone: "text-red-700", valor: "text-red-700", caixa: "bg-red-50 border-red-200 text-red-800" },
          orange: { borda: "border-orange-300", bg: "bg-orange-100", icone: "text-orange-700", valor: "text-orange-700", caixa: "bg-orange-50 border-orange-200 text-orange-900" },
          purple: { borda: "border-purple-300", bg: "bg-purple-100", icone: "text-purple-700", valor: "text-purple-700", caixa: "bg-purple-50 border-purple-200 text-purple-900" },
          stone: { borda: "border-stone-300", bg: "bg-stone-100", icone: "text-stone-700", valor: "text-stone-700", caixa: "bg-stone-50 border-stone-200 text-stone-900" },
        };
        let p;
        if (canceladas) {
          p = paletas.stone;
        } else {
          const info = MOTIVOS_DIVERGENCIA[v.motivo] || MOTIVOS_DIVERGENCIA.sem_no_erp;
          p = paletas[info.cor] || paletas.red;
        }

        return (
          <div key={i} className={`border ${p.borda} bg-white rounded-lg p-4`}>
            <div className="flex items-start gap-4">
              <div className={`w-10 h-10 rounded-md ${p.bg} flex items-center justify-center flex-shrink-0`}>
                <AlertTriangle className={`w-5 h-5 ${p.icone}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 mb-1 flex-wrap">
                  <span className="text-xs font-mono text-stone-500">
                    {formatarData(v.dataVenda)}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded font-semibold">
                    {v.bandeira}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider bg-stone-100 text-stone-600 px-1.5 py-0.5 rounded">
                    {v.qtdParcelas}x {v.tipo}
                  </span>
                  {canceladas && (
                    <span className="text-[10px] uppercase tracking-wider bg-red-100 text-red-800 px-1.5 py-0.5 rounded font-semibold">
                      {v.status}
                    </span>
                  )}
                  {!canceladas && <MotivoBadge motivo={v.motivo} />}
                </div>
                <h3 className="font-serif font-semibold text-stone-900">
                  NSU: <span className="font-mono">{v.autorizacao}</span>
                </h3>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-600 mt-1">
                  <span>ID interno {nomeMaquininha}: <strong className="font-mono text-stone-900">{v.nsu}</strong></span>
                  <span>Terminal: <strong className="font-mono text-stone-900">{v.terminal}</strong></span>
                </div>
                {!canceladas && v.motivoDetalhe && (
                  <div className={`mt-2 text-xs px-3 py-2 rounded border ${p.caixa}`}>
                    <strong>Motivo:</strong> {v.motivoDetalhe}
                  </div>
                )}
              </div>
              <div className="text-right flex-shrink-0">
                <p className={`font-serif text-xl font-bold ${p.valor}`}>
                  {formatarMoeda(v.valorBrutoTotal)}
                </p>
                <p className="text-xs text-stone-500 mt-0.5">
                  Líquido: {formatarMoeda(v.valorLiquidoTotal)}
                </p>
                {!canceladas && v.candidatoErp && (
                  <p className="text-xs text-stone-500 mt-0.5">
                    ERP: {formatarMoeda(v.candidatoErp.valor)}
                    {v.motivo === "nsu_divergente" && (
                      <span className="block">NSU ERP: <span className="font-mono">{v.candidatoErp.nsuErp}</span></span>
                    )}
                  </p>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Lista de vendas com taxa cobrada acima da negociada
function BluTaxasForaList({ items, tabelaTaxas, tipoMaquininha = "blu" }) {
  if (!items.length) {
    return (
      <div className="text-center py-12">
        <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto mb-3" />
        <p className="font-serif text-lg text-stone-800">Todas as taxas estão dentro do acordado</p>
        <p className="text-sm text-stone-600 mt-1">
          Não há nenhuma venda com taxa cobrada acima da negociada.
        </p>
      </div>
    );
  }

  // Map dos nomes amigáveis dos tipos/grupos para legendar
  // Blu: 6 tipos × 2 grupos. PV: 22 linhas, sem grupo.
  const ehPV = tipoMaquininha === "pague_veloz";
  const nomesTipo = ehPV
    ? Object.fromEntries(LINHAS_TAXAS_PV.map((l) => [l.id, l.nome]))
    : Object.fromEntries(TIPOS_OPERACAO_BLU.map((t) => [t.id, t.nome]));
  const nomesGrupo = ehPV
    ? {}
    : Object.fromEntries(GRUPOS_BANDEIRA_BLU.map((g) => [g.id, g.nome]));
  const nomeMaquininha = ehPV ? "Pague Veloz" : "Blu";

  return (
    <div className="space-y-2">
      <div className="bg-orange-50 border border-orange-300 rounded-lg p-3 mb-3 flex items-start gap-2">
        <AlertCircle className="w-4 h-4 text-orange-700 mt-0.5 flex-shrink-0" />
        <div className="text-xs text-orange-900">
          <p className="font-semibold mb-1">Vendas em que a {nomeMaquininha} cobrou taxa MAIOR que a negociada.</p>
          <p>A diferença está em <strong>pontos percentuais (pp)</strong>. Para corrigir os valores acordados, vá em <strong>Tabelas de Taxas de Cartões</strong> no menu lateral.</p>
        </div>
      </div>

      {items.map((x, i) => {
        const c = x.conferencia;
        const tipoNome = nomesTipo[c.tipoId] || c.tipoId;
        const grupoNome = nomesGrupo[c.grupoId] || "";
        const faixaTexto = ehPV ? tipoNome : `${tipoNome} / ${grupoNome}`;
        const prejuizoVenda = (c.diferenca / 100) * x.blu.valorBrutoTotal;

        return (
          <div key={i} className="border border-orange-300 bg-white rounded-lg p-4">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-md bg-orange-100 flex items-center justify-center flex-shrink-0">
                <AlertCircle className="w-5 h-5 text-orange-700" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 mb-1 flex-wrap">
                  <span className="text-xs font-mono text-stone-500">{x.erp.dataStr}</span>
                  <span className="text-[10px] uppercase tracking-wider bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded font-semibold">
                    {x.blu.bandeira}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider bg-stone-100 text-stone-600 px-1.5 py-0.5 rounded">
                    {x.blu.qtdParcelas}x {x.blu.tipo}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider bg-orange-100 text-orange-900 px-1.5 py-0.5 rounded font-semibold border border-orange-300">
                    +{c.diferenca.toFixed(2).replace(".", ",")}pp
                  </span>
                </div>
                <h3 className="font-serif font-semibold text-stone-900 truncate">
                  {x.erp.cliente}
                </h3>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-600 mt-1">
                  <span>Loja: <strong className="text-stone-900">{x.erp.loja}</strong></span>
                  <span>Nº Venda: <strong className="text-stone-900">{x.erp.numVenda}</strong></span>
                  <span>NSU: <strong className="font-mono text-stone-900">{x.blu.autorizacao}</strong></span>
                </div>
                <div className="mt-2 text-xs px-3 py-2 rounded border bg-orange-50 border-orange-200 text-orange-900">
                  <strong>Taxa cobrada: {c.taxaCobrada.toFixed(2).replace(".", ",")}%</strong>
                  {" — "}
                  Tabela negociada para <strong>{faixaTexto}</strong>: {c.taxaNegociada.toFixed(2).replace(".", ",")}%.
                  {" "}
                  Diferença de <strong>+{c.diferenca.toFixed(2).replace(".", ",")} pp</strong>
                  {" "}
                  (prejuízo nesta venda ≈ <strong>{formatarMoeda(prejuizoVenda)}</strong>).
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="font-serif text-xl font-bold text-orange-700">
                  {formatarMoeda(x.blu.valorBrutoTotal)}
                </p>
                <p className="text-xs text-stone-500 mt-0.5">
                  Líquido: {formatarMoeda(x.blu.valorLiquidoTotal)}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ConciliadosFinanceirosList({ items }) {
  const [expanded, setExpanded] = useState(null);

  if (!items.length) {
    return (
      <div className="text-center py-12 text-stone-500 text-sm">
        Nenhum lançamento conciliado ainda.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((c, i) => {
        const isAviso = c.conferir || c.diffDias > 0;
        const corBorda = isAviso
          ? "border-red-200 bg-red-50/30"
          : "border-emerald-200 bg-white";
        return (
          <div key={i} className={`border rounded-lg overflow-hidden ${corBorda}`}>
            <button
              onClick={() => setExpanded(expanded === i ? null : i)}
              className="w-full flex items-start p-4 gap-4 text-left hover:bg-stone-50/30 transition-colors"
            >
              <div
                className={`w-10 h-10 rounded-md flex items-center justify-center flex-shrink-0 ${
                  isAviso ? "bg-red-100" : "bg-emerald-100"
                }`}
              >
                {isAviso ? (
                  <AlertCircle className="w-5 h-5 text-red-700" />
                ) : (
                  <CheckCircle2 className="w-5 h-5 text-emerald-700" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="text-xs font-mono text-stone-500">
                    {c.erp.dataStr}
                    {c.diffDias > 0 && (
                      <span className="text-red-700 ml-1">
                        ⇄ {c.banco.dataStr}
                      </span>
                    )}
                  </span>
                  {c.conferir && (
                    <span className="text-[10px] uppercase tracking-wider bg-red-200 text-red-800 px-1.5 py-0.5 rounded font-semibold">
                      Conferir
                    </span>
                  )}
                  {c.diffDias > 0 && (
                    <span className="text-[10px] uppercase tracking-wider bg-stone-200 text-stone-700 px-1.5 py-0.5 rounded">
                      {c.diffDias} dia{c.diffDias > 1 ? "s" : ""} de diferença
                    </span>
                  )}
                </div>
                <h3 className="font-serif font-semibold text-stone-900 truncate">
                  {c.erp.historico}
                </h3>
              </div>
              <div className="flex items-center gap-4 flex-shrink-0">
                <p
                  className={`font-serif text-xl font-bold ${
                    c.erp.valor < 0 ? "text-red-700" : "text-emerald-700"
                  }`}
                >
                  {formatarMoeda(c.erp.valor)}
                </p>
                <ChevronRight
                  className={`w-4 h-4 text-stone-400 transition-transform ${
                    expanded === i ? "rotate-90" : ""
                  }`}
                />
              </div>
            </button>
            {expanded === i && (
              <div className="border-t border-stone-200 bg-stone-50/50 p-4 grid md:grid-cols-2 gap-4 text-xs">
                <div className="bg-white border border-stone-200 rounded p-3">
                  <p className="text-[10px] uppercase tracking-wider font-semibold text-stone-600 mb-2">
                    Lançamento no ERP
                  </p>
                  <p className="text-stone-900 mb-1">
                    <strong>{c.erp.dataStr}</strong>
                  </p>
                  <p className="text-stone-700 break-words">{c.erp.historico}</p>
                  {c.erp.documento && (
                    <p className="text-stone-500 font-mono mt-1">
                      Doc: {c.erp.documento}
                    </p>
                  )}
                </div>
                <div className="bg-white border border-stone-200 rounded p-3">
                  <p className="text-[10px] uppercase tracking-wider font-semibold text-stone-600 mb-2">
                    Lançamento no Banco
                  </p>
                  <p className="text-stone-900 mb-1">
                    <strong>{c.banco.dataStr}</strong>
                  </p>
                  <p className="text-stone-700 break-words">{c.banco.historico}</p>
                  {c.banco.documento && (
                    <p className="text-stone-500 font-mono mt-1">
                      Doc: {c.banco.documento}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DivergenciaSimplesList({ items, cor }) {
  const cores = {
    red: { borda: "border-red-200", bg: "bg-red-50/30", icone: "text-red-700", iconeBg: "bg-red-100" },
    amber: { borda: "border-red-200", bg: "bg-red-50/30", icone: "text-red-700", iconeBg: "bg-red-100" },
  };
  const c = cores[cor] || cores.red;

  if (!items.length) {
    return (
      <div className="text-center py-12">
        <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto mb-3" />
        <p className="font-serif text-lg text-stone-800">
          Nenhuma divergência aqui
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div
          key={i}
          className={`border ${c.borda} bg-white rounded-lg p-4`}
        >
          <div className="flex items-start gap-4 mb-3">
            <div
              className={`w-10 h-10 rounded-md ${c.iconeBg} flex items-center justify-center flex-shrink-0`}
            >
              <AlertTriangle className={`w-5 h-5 ${c.icone}`} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-serif font-semibold text-stone-900 break-words mb-1">
                {it.historico}
              </h3>
              <p className="text-xs text-stone-500">
                {it.dataStr}
                {it.documento && (
                  <span className="ml-2 font-mono">· Doc: {it.documento}</span>
                )}
              </p>
            </div>
            <p
              className={`font-serif text-xl font-bold flex-shrink-0 ${
                it.valor < 0 ? "text-red-700" : "text-emerald-700"
              }`}
            >
              {formatarMoeda(it.valor)}
            </p>
          </div>

          {/* Detalhes completos */}
          <div className="bg-stone-50 border border-stone-200 rounded p-3 grid sm:grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
            <div>
              <span className="text-stone-500 uppercase tracking-wider text-[10px] font-semibold">Data</span>
              <p className="text-stone-900 font-mono">{it.dataStr}</p>
            </div>
            <div>
              <span className="text-stone-500 uppercase tracking-wider text-[10px] font-semibold">Valor</span>
              <p className={`font-mono font-semibold ${it.valor < 0 ? "text-red-700" : "text-emerald-700"}`}>
                {formatarMoeda(it.valor)}
              </p>
            </div>
            <div className="sm:col-span-2">
              <span className="text-stone-500 uppercase tracking-wider text-[10px] font-semibold">Histórico</span>
              <p className="text-stone-900 break-words">{it.historico || "—"}</p>
            </div>
            <div className="sm:col-span-2">
              <span className="text-stone-500 uppercase tracking-wider text-[10px] font-semibold">Documento</span>
              <p className="text-stone-900 font-mono break-words">{it.documento || "—"}</p>
            </div>
            {it.raw && (
              <div className="sm:col-span-2">
                <span className="text-stone-500 uppercase tracking-wider text-[10px] font-semibold">Linha original do extrato</span>
                <p className="text-stone-700 font-mono break-words text-[11px] mt-0.5">
                  {typeof it.raw === "string" ? it.raw : JSON.stringify(it.raw)}
                </p>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function PermissoesModule({ userCtx, onUserAlterado }) {
  // Quem é RH (não admin) vê só a aba de usuários — sem grupos nem lojas
  const ehSomenteRH = userCtx.isRH && !userCtx.isAdmin;

  // Aba ativa: "grupos" | "lojas" | "usuarios"
  const [aba, setAba] = useState("usuarios");
  const [loadingInicial, setLoadingInicial] = useState(true);
  const [error, setError] = useState(null);

  // Dados carregados do servidor
  const [grupos, setGrupos] = useState([]);
  const [lojas, setLojas] = useState([]);
  const [usuariosCadastrados, setUsuariosCadastrados] = useState([]); // já têm grupo
  const [usuariosDisponiveis, setUsuariosDisponiveis] = useState([]); // novos cadastros sem grupo

  // Carrega tudo
  const carregar = useCallback(async () => {
    setError(null);
    try {
      const [resGrupos, resLojas, resUsuariosCom, resUsuariosSem, resPerms] = await Promise.all([
        supabase.from("grupos").select("id, nome, descricao, permissoes").order("nome"),
        supabase.from("lojas").select("id, nome, eh_escritorio, ativa").order("nome"),
        supabase.from("vw_usuarios_completo").select("user_id, email, grupo_id, grupo_nome, lojas_ids, lojas_nomes"),
        supabase.from("vw_usuarios_disponiveis").select("user_id, email, cadastrado_em"),
        supabase.from("user_permissions").select("user_id, is_admin, eh_rh"),
      ]);

      if (resGrupos.error) throw resGrupos.error;
      if (resLojas.error) throw resLojas.error;
      if (resUsuariosCom.error) throw resUsuariosCom.error;
      if (resUsuariosSem.error) throw resUsuariosSem.error;
      // resPerms pode falhar pra RH (se RLS bloquear) — não é fatal
      const permsMap = new Map();
      if (!resPerms.error && resPerms.data) {
        for (const p of resPerms.data) {
          permsMap.set(p.user_id, { is_admin: !!p.is_admin, eh_rh: !!p.eh_rh });
        }
      }

      // Anexa info de admin/RH em cada usuário
      let usuariosCom = (resUsuariosCom.data || []).map((u) => ({
        ...u,
        is_admin: permsMap.get(u.user_id)?.is_admin || false,
        eh_rh: permsMap.get(u.user_id)?.eh_rh || false,
      }));

      // Se for somente RH, filtra: esconde usuários que estão no Escritório
      if (ehSomenteRH) {
        const escritorioIds = (resLojas.data || [])
          .filter((l) => l.eh_escritorio)
          .map((l) => l.id);
        usuariosCom = usuariosCom.filter((u) => {
          const lojas = u.lojas_ids || [];
          // Esconde se TEM alguma loja do Escritório
          return !lojas.some((id) => escritorioIds.includes(id));
        });
      }

      setGrupos(resGrupos.data || []);
      setLojas(resLojas.data || []);
      setUsuariosCadastrados(usuariosCom);
      setUsuariosDisponiveis(resUsuariosSem.data || []);
    } catch (e) {
      console.error("[Permissoes] Erro ao carregar:", e);
      setError("Erro ao carregar dados: " + e.message);
    } finally {
      setLoadingInicial(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  if (loadingInicial) {
    return (
      <div className="flex items-center gap-2 text-stone-500 justify-center py-20">
        <Loader2 className="w-5 h-5 animate-spin" />
        Carregando permissões…
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-8 border-b border-stone-200 pb-6">
        <div className="flex items-baseline gap-3 mb-2">
          <span className="text-xs uppercase tracking-[0.2em] text-red-700 font-semibold">
            Administração
          </span>
          <span className="text-stone-300">—</span>
          <span className="text-xs uppercase tracking-wider text-stone-500">
            Acessos e Permissões
          </span>
        </div>
        <h1 className="font-serif text-4xl font-bold text-stone-900 tracking-tight">
          Gerenciar Permissões
        </h1>
        {ehSomenteRH ? (
          <p className="text-stone-600 mt-2 max-w-2xl">
            Cadastre funcionários das lojas físicas, atribua-os a grupos e lojas.
          </p>
        ) : (
          <p className="text-stone-600 mt-2 max-w-2xl">
            Controle quem pode acessar cada módulo do app. Crie grupos, defina o que cada
            grupo pode fazer e atribua usuários a grupos e lojas.
          </p>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-700 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-900">{error}</p>
        </div>
      )}

      {/* Abas — RH só vê 'Usuários'. Admin vê as 3 */}
      <div className="flex bg-stone-100 rounded-md p-1 mb-6 inline-flex">
        <button
          onClick={() => setAba("usuarios")}
          className={`px-4 py-1.5 text-sm font-medium rounded transition-colors ${
            aba === "usuarios" ? "bg-white text-red-800 shadow-sm" : "text-stone-600 hover:text-stone-900"
          }`}
        >
          Usuários ({usuariosCadastrados.length})
          {usuariosDisponiveis.length > 0 && (
            <span className="ml-2 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold rounded-full bg-red-600 text-white">
              {usuariosDisponiveis.length}
            </span>
          )}
        </button>
        {!ehSomenteRH && (
          <>
            <button
              onClick={() => setAba("grupos")}
              className={`px-4 py-1.5 text-sm font-medium rounded transition-colors ${
                aba === "grupos" ? "bg-white text-red-800 shadow-sm" : "text-stone-600 hover:text-stone-900"
              }`}
            >
              Grupos ({grupos.length})
            </button>
            <button
              onClick={() => setAba("lojas")}
              className={`px-4 py-1.5 text-sm font-medium rounded transition-colors ${
                aba === "lojas" ? "bg-white text-red-800 shadow-sm" : "text-stone-600 hover:text-stone-900"
              }`}
            >
              Lojas ({lojas.length})
            </button>
          </>
        )}
      </div>

      {aba === "usuarios" && (
        <UsuariosTab
          usuariosCadastrados={usuariosCadastrados}
          usuariosDisponiveis={usuariosDisponiveis}
          grupos={grupos}
          lojas={lojas}
          userCtx={userCtx}
          onChange={() => {
            carregar();
            if (onUserAlterado) onUserAlterado();
          }}
        />
      )}

      {aba === "grupos" && (
        <GruposTab grupos={grupos} onChange={carregar} />
      )}

      {aba === "lojas" && (
        <LojasTab lojas={lojas} onChange={carregar} />
      )}
    </div>
  );
}

// ============================================================
// Aba USUÁRIOS — atribuir grupo + lojas a cada usuário cadastrado
// ============================================================

function UsuariosTab({ usuariosCadastrados, usuariosDisponiveis, grupos, lojas, userCtx, onChange }) {
  const ehSomenteRH = userCtx.isRH && !userCtx.isAdmin;

  const [editando, setEditando] = useState(null); // user_id sendo editado
  const [draftGrupoId, setDraftGrupoId] = useState(null);
  const [draftLojasIds, setDraftLojasIds] = useState([]);
  const [salvando, setSalvando] = useState(false);
  const [erroLinha, setErroLinha] = useState(null);

  // ETAPA C+: modal de convite por e-mail
  const [convidando, setConvidando] = useState(false);
  const [conviteEmail, setConviteEmail] = useState("");
  const [conviteGrupoId, setConviteGrupoId] = useState(null);
  const [conviteLojasIds, setConviteLojasIds] = useState([]);
  const [conviteErro, setConviteErro] = useState(null);
  const [conviteSucesso, setConviteSucesso] = useState(null);
  const [enviandoConvite, setEnviandoConvite] = useState(false);

  // IDs das lojas que o usuário atual NÃO PODE atribuir
  // (RH não pode atribuir Escritório; admin pode tudo)
  const lojasBloqueadasIds = useMemo(() => {
    if (!ehSomenteRH) return [];
    return lojas.filter((l) => l.eh_escritorio).map((l) => l.id);
  }, [ehSomenteRH, lojas]);

  const iniciarEdicao = (u, ehNovo) => {
    setEditando(u.user_id);
    setErroLinha(null);
    if (ehNovo) {
      setDraftGrupoId(grupos[0]?.id || null);
      setDraftLojasIds([]);
    } else {
      setDraftGrupoId(u.grupo_id);
      setDraftLojasIds(u.lojas_ids || []);
    }
  };

  const cancelarEdicao = () => {
    setEditando(null);
    setDraftGrupoId(null);
    setDraftLojasIds([]);
    setErroLinha(null);
  };

  const toggleLoja = (lojaId) => {
    if (lojasBloqueadasIds.includes(lojaId)) return; // bloqueio pra RH
    setDraftLojasIds((prev) =>
      prev.includes(lojaId) ? prev.filter((id) => id !== lojaId) : [...prev, lojaId]
    );
  };

  const validarLojas = (lojasIds) => {
    if (!ehSomenteRH) return null;
    const temEscritorio = lojasIds.some((id) => lojasBloqueadasIds.includes(id));
    if (temEscritorio) return "Você não pode atribuir a loja Escritório (apenas o admin pode).";
    return null;
  };

  const salvar = async (userId) => {
    const erro = validarLojas(draftLojasIds);
    if (erro) {
      setErroLinha(erro);
      return;
    }
    setSalvando(true);
    setErroLinha(null);
    try {
      // 1) Define o grupo (upsert na tabela usuarios_grupos)
      const { error: errGrupo } = await supabase
        .from("usuarios_grupos")
        .upsert({ user_id: userId, grupo_id: draftGrupoId, updated_at: new Date().toISOString() });
      if (errGrupo) throw errGrupo;

      // 2) Reseta as lojas: apaga as antigas e insere as novas
      const { error: errDel } = await supabase
        .from("usuarios_lojas")
        .delete()
        .eq("user_id", userId);
      if (errDel) throw errDel;

      if (draftLojasIds.length > 0) {
        const linhas = draftLojasIds.map((lojaId) => ({ user_id: userId, loja_id: lojaId }));
        const { error: errIns } = await supabase.from("usuarios_lojas").insert(linhas);
        if (errIns) throw errIns;
      }

      cancelarEdicao();
      onChange();
    } catch (e) {
      console.error("[UsuariosTab] Erro ao salvar:", e);
      if (e.message?.includes("policy") || e.code === "42501") {
        setErroLinha("Sem permissão. Apenas admin ou RH pode alterar permissões.");
      } else {
        setErroLinha("Erro ao salvar: " + e.message);
      }
    } finally {
      setSalvando(false);
    }
  };

  const remover = async (userId, email) => {
    if (!confirm(`Remover acesso de ${email}?\n\nO usuário não vai poder mais usar o app até ser adicionado a um grupo de novo.`)) return;
    setSalvando(true);
    try {
      await supabase.from("usuarios_lojas").delete().eq("user_id", userId);
      const { error } = await supabase.from("usuarios_grupos").delete().eq("user_id", userId);
      if (error) throw error;
      onChange();
    } catch (e) {
      alert("Erro ao remover: " + e.message);
    } finally {
      setSalvando(false);
    }
  };

  // ETAPA C+: alternar status de RH (só admin pode chamar)
  const alternarRH = async (userId, ehRhAtual, email) => {
    const novoStatus = !ehRhAtual;
    const acao = novoStatus ? "promover a RH" : "remover de RH";
    if (!confirm(`${acao.charAt(0).toUpperCase() + acao.slice(1)} ${email}?\n\n${
      novoStatus
        ? "Esta pessoa vai poder cadastrar e editar funcionários das lojas físicas."
        : "Esta pessoa vai perder o acesso ao painel de Permissões."
    }`)) return;
    setSalvando(true);
    try {
      const { error } = await supabase
        .from("user_permissions")
        .update({ eh_rh: novoStatus, updated_at: new Date().toISOString() })
        .eq("user_id", userId);
      if (error) {
        if (error.message?.includes("policy") || error.code === "42501") {
          alert("Sem permissão. Apenas admin pode marcar usuários como RH.");
        } else {
          alert("Erro: " + error.message);
        }
        return;
      }
      onChange();
    } finally {
      setSalvando(false);
    }
  };

  // ===== CONVITE POR E-MAIL =====
  const abrirConvite = () => {
    setConvidando(true);
    setConviteEmail("");
    setConviteGrupoId(grupos[0]?.id || null);
    setConviteLojasIds([]);
    setConviteErro(null);
    setConviteSucesso(null);
  };

  const fecharConvite = () => {
    setConvidando(false);
    setConviteEmail("");
    setConviteErro(null);
    setConviteSucesso(null);
  };

  const toggleLojaConvite = (lojaId) => {
    if (lojasBloqueadasIds.includes(lojaId)) return;
    setConviteLojasIds((prev) =>
      prev.includes(lojaId) ? prev.filter((id) => id !== lojaId) : [...prev, lojaId]
    );
  };

  const enviarConvite = async () => {
    setConviteErro(null);
    setConviteSucesso(null);

    const email = conviteEmail.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      setConviteErro("E-mail inválido.");
      return;
    }
    if (!conviteGrupoId) {
      setConviteErro("Selecione um grupo.");
      return;
    }
    if (conviteLojasIds.length === 0) {
      setConviteErro("Selecione ao menos uma loja.");
      return;
    }
    const erroLojas = validarLojas(conviteLojasIds);
    if (erroLojas) {
      setConviteErro(erroLojas);
      return;
    }

    setEnviandoConvite(true);
    try {
      // 1) Envia o e-mail de convite (Supabase manda link pra criar senha)
      // OBS: o Supabase JS não tem método "invite" direto pelo client comum —
      // usamos signUp com uma senha temporária aleatória que o usuário trocará.
      // O usuário recebe e-mail de confirmação (se confirmação tiver ativada
      // no Supabase) ou já entra direto.
      const senhaTemp = "T" + Math.random().toString(36).slice(2, 12) + "!" + Math.floor(Math.random() * 1000);
      const { data: signUpData, error: errSignUp } = await supabase.auth.signUp({
        email,
        password: senhaTemp,
        options: {
          emailRedirectTo: window.location.origin,
        },
      });

      if (errSignUp) {
        if (errSignUp.message.toLowerCase().includes("already registered")) {
          setConviteErro("Esse e-mail já tem conta. Edite o usuário existente em vez de convidar de novo.");
        } else {
          setConviteErro("Erro ao convidar: " + errSignUp.message);
        }
        return;
      }

      const novoUserId = signUpData?.user?.id;
      if (!novoUserId) {
        setConviteErro("Convite enviado, mas não consegui pegar o ID do usuário. Atualize a página.");
        return;
      }

      // 2) Atribui o grupo pelo upsert
      const { error: errGrupo } = await supabase
        .from("usuarios_grupos")
        .upsert({ user_id: novoUserId, grupo_id: conviteGrupoId, updated_at: new Date().toISOString() });
      if (errGrupo) throw errGrupo;

      // 3) Atribui as lojas
      const linhas = conviteLojasIds.map((lojaId) => ({ user_id: novoUserId, loja_id: lojaId }));
      const { error: errLojas } = await supabase.from("usuarios_lojas").insert(linhas);
      if (errLojas) throw errLojas;

      setConviteSucesso(
        `Convite enviado para ${email}! ` +
        `O funcionário vai receber um e-mail e precisa clicar pra confirmar. ` +
        `Depois pode fazer login com a senha que ele criar.`
      );
      // Limpa o form mas mantém o modal aberto pra mostrar a mensagem
      setConviteEmail("");
      setConviteLojasIds([]);
      onChange();
    } catch (e) {
      console.error("[UsuariosTab] Erro no convite:", e);
      setConviteErro("Erro ao processar convite: " + e.message);
    } finally {
      setEnviandoConvite(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Botão de convidar funcionário (admin e RH) */}
      <div className="flex justify-end">
        <button
          onClick={abrirConvite}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-red-700 text-white rounded-md hover:bg-red-800 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Cadastrar funcionário
        </button>
      </div>

      {/* Modal de convite */}
      {convidando && (
        <div className="border-2 border-red-300 bg-red-50/30 rounded-lg p-4 space-y-3">
          <div className="flex items-start justify-between">
            <h3 className="font-serif text-lg font-semibold text-stone-900">
              Cadastrar novo funcionário
            </h3>
            <button
              onClick={fecharConvite}
              className="p-1 text-stone-500 hover:bg-stone-100 rounded"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <p className="text-xs text-stone-600">
            O funcionário vai receber um e-mail pra confirmar o cadastro e definir a senha dele.
          </p>

          <div>
            <label className="text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1.5 block">
              E-mail do funcionário
            </label>
            <input
              type="email"
              value={conviteEmail}
              onChange={(e) => setConviteEmail(e.target.value)}
              placeholder="exemplo@sofashow.com.br"
              autoFocus
              className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-red-700/30 focus:border-red-700"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1.5 block">
              Grupo
            </label>
            <select
              value={conviteGrupoId || ""}
              onChange={(e) => setConviteGrupoId(parseInt(e.target.value) || null)}
              className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-red-700/30 focus:border-red-700"
            >
              {grupos.map((g) => (
                <option key={g.id} value={g.id}>{g.nome}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1.5 block">
              Lojas (selecione uma ou mais)
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {lojas.filter((l) => l.ativa).map((l) => {
                const bloqueada = lojasBloqueadasIds.includes(l.id);
                const marcada = conviteLojasIds.includes(l.id);
                return (
                  <label
                    key={l.id}
                    className={`flex items-center gap-2 px-3 py-2 text-sm border rounded transition-colors ${
                      bloqueada
                        ? "bg-stone-100 border-stone-200 text-stone-400 cursor-not-allowed"
                        : marcada
                        ? "bg-red-50 border-red-300 text-red-900 cursor-pointer"
                        : "bg-white border-stone-200 text-stone-700 hover:bg-stone-50 cursor-pointer"
                    }`}
                    title={bloqueada ? "Apenas admin pode atribuir esta loja" : ""}
                  >
                    <input
                      type="checkbox"
                      checked={marcada}
                      disabled={bloqueada}
                      onChange={() => toggleLojaConvite(l.id)}
                      className="w-3.5 h-3.5 accent-red-700"
                    />
                    <span className="flex-1">
                      {l.nome}
                      {l.eh_escritorio && (
                        <span className="ml-1 text-[10px] text-red-700 font-semibold">★</span>
                      )}
                      {bloqueada && (
                        <span className="ml-1 text-[9px] text-stone-400">(só admin)</span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
            {!ehSomenteRH && (
              <p className="text-xs text-stone-500 mt-2">
                <span className="text-red-700 font-semibold">★</span> Escritório libera os módulos administrativos
              </p>
            )}
          </div>

          {conviteErro && (
            <div className="bg-red-50 border border-red-200 rounded-md p-2 text-xs text-red-900">
              {conviteErro}
            </div>
          )}
          {conviteSucesso && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-md p-2 text-xs text-emerald-900">
              {conviteSucesso}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button
              onClick={enviarConvite}
              disabled={enviandoConvite}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-emerald-700 text-white font-medium rounded-md hover:bg-emerald-800 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {enviandoConvite ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
              Enviar convite
            </button>
            <button
              onClick={fecharConvite}
              disabled={enviandoConvite}
              className="px-3 py-2 text-sm text-stone-600 hover:text-stone-900"
            >
              Fechar
            </button>
          </div>
        </div>
      )}

      {/* Usuários novos esperando atribuição */}
      {usuariosDisponiveis.length > 0 && (
        <div>
          <h2 className="font-serif text-lg font-semibold text-stone-900 mb-3 flex items-center gap-2">
            <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[10px] font-bold rounded-full bg-red-600 text-white">
              {usuariosDisponiveis.length}
            </span>
            Esperando atribuição
          </h2>
          <p className="text-xs text-stone-600 mb-3">
            Estes usuários se cadastraram e ainda não têm grupo. Atribua um grupo + lojas pra liberar o acesso.
          </p>
          <div className="space-y-2">
            {usuariosDisponiveis.map((u) => (
              <UsuarioCard
                key={u.user_id}
                u={u}
                ehNovo={true}
                grupos={grupos}
                lojas={lojas}
                lojasBloqueadasIds={lojasBloqueadasIds}
                ehSomenteRH={ehSomenteRH}
                editando={editando === u.user_id}
                draftGrupoId={draftGrupoId}
                draftLojasIds={draftLojasIds}
                erroLinha={erroLinha}
                salvando={salvando}
                onChangeGrupo={setDraftGrupoId}
                onToggleLoja={toggleLoja}
                onIniciarEdicao={() => iniciarEdicao(u, true)}
                onCancelar={cancelarEdicao}
                onSalvar={() => salvar(u.user_id)}
                onRemover={null}
              />
            ))}
          </div>
        </div>
      )}

      {/* Usuários já cadastrados */}
      <div>
        <h2 className="font-serif text-lg font-semibold text-stone-900 mb-3">
          Usuários com acesso
        </h2>
        {usuariosCadastrados.length === 0 ? (
          <div className="text-center py-12 bg-stone-50 rounded-lg text-stone-500 text-sm">
            Nenhum usuário com acesso ainda.
          </div>
        ) : (
          <div className="space-y-2">
            {usuariosCadastrados.map((u) => (
              <UsuarioCard
                key={u.user_id}
                u={u}
                ehNovo={false}
                grupos={grupos}
                lojas={lojas}
                lojasBloqueadasIds={lojasBloqueadasIds}
                ehSomenteRH={ehSomenteRH}
                editando={editando === u.user_id}
                draftGrupoId={draftGrupoId}
                draftLojasIds={draftLojasIds}
                erroLinha={erroLinha}
                salvando={salvando}
                mostrarRH={userCtx.isAdmin}
                onAlternarRH={() => alternarRH(u.user_id, u.eh_rh, u.email)}
                onChangeGrupo={setDraftGrupoId}
                onToggleLoja={toggleLoja}
                onIniciarEdicao={() => iniciarEdicao(u, false)}
                onCancelar={cancelarEdicao}
                onSalvar={() => salvar(u.user_id)}
                onRemover={() => remover(u.user_id, u.email)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function UsuarioCard({
  u, ehNovo, grupos, lojas, lojasBloqueadasIds = [], ehSomenteRH = false, editando,
  draftGrupoId, draftLojasIds, erroLinha, salvando,
  mostrarRH = false, onAlternarRH = null,
  onChangeGrupo, onToggleLoja, onIniciarEdicao, onCancelar, onSalvar, onRemover,
}) {
  return (
    <div className={`border rounded-lg bg-white overflow-hidden ${editando ? "border-red-300 shadow-md" : "border-stone-200"}`}>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-serif text-sm font-semibold text-stone-900 truncate">{u.email}</p>
              {u.is_admin && (
                <span className="text-[9px] uppercase tracking-wider bg-red-700 text-white px-1.5 py-0.5 rounded">
                  Admin
                </span>
              )}
              {u.eh_rh && !u.is_admin && (
                <span className="text-[9px] uppercase tracking-wider bg-amber-600 text-white px-1.5 py-0.5 rounded">
                  RH
                </span>
              )}
            </div>
            {!editando && !ehNovo && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-600 mt-1">
                <span>Grupo: <strong className="text-red-800">{u.grupo_nome}</strong></span>
                {u.lojas_nomes ? (
                  <span>Lojas: <strong className="text-stone-900">{u.lojas_nomes}</strong></span>
                ) : (
                  <span className="text-amber-700">⚠ Sem lojas atribuídas</span>
                )}
              </div>
            )}
            {ehNovo && !editando && (
              <p className="text-xs text-stone-500 mt-0.5">Aguardando atribuição</p>
            )}
          </div>
          {!editando && (
            <div className="flex gap-2 flex-shrink-0">
              {mostrarRH && onAlternarRH && !u.is_admin && (
                <button
                  onClick={onAlternarRH}
                  disabled={salvando}
                  className={`flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-md border ${
                    u.eh_rh
                      ? "bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100"
                      : "bg-white text-stone-600 border-stone-300 hover:bg-stone-50"
                  }`}
                  title={u.eh_rh ? "Remover de RH" : "Marcar como RH"}
                >
                  <Users className="w-3 h-3" />
                  {u.eh_rh ? "É RH" : "Tornar RH"}
                </button>
              )}
              <button
                onClick={onIniciarEdicao}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-red-800 border border-red-200 rounded-md hover:bg-red-50"
              >
                <Pencil className="w-3 h-3" />
                {ehNovo ? "Atribuir" : "Editar"}
              </button>
              {onRemover && (
                <button
                  onClick={onRemover}
                  disabled={salvando}
                  className="p-1.5 text-stone-500 hover:bg-red-50 hover:text-red-700 rounded-md"
                  title="Remover acesso"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
        </div>

        {editando && (
          <div className="space-y-3 mt-3 pt-3 border-t border-stone-100">
            {/* Seleção de grupo */}
            <div>
              <label className="text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1.5 block">
                Grupo
              </label>
              <select
                value={draftGrupoId || ""}
                onChange={(e) => onChangeGrupo(parseInt(e.target.value) || null)}
                className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-red-700/30 focus:border-red-700"
              >
                {grupos.map((g) => (
                  <option key={g.id} value={g.id}>{g.nome}</option>
                ))}
              </select>
            </div>

            {/* Seleção de lojas */}
            <div>
              <label className="text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1.5 block">
                Lojas (selecione uma ou mais)
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {lojas.filter((l) => l.ativa).map((l) => {
                  const bloqueada = lojasBloqueadasIds.includes(l.id);
                  const marcada = draftLojasIds.includes(l.id);
                  return (
                    <label
                      key={l.id}
                      className={`flex items-center gap-2 px-3 py-2 text-sm border rounded transition-colors ${
                        bloqueada
                          ? "bg-stone-100 border-stone-200 text-stone-400 cursor-not-allowed"
                          : marcada
                          ? "bg-red-50 border-red-300 text-red-900 cursor-pointer"
                          : "bg-white border-stone-200 text-stone-700 hover:bg-stone-50 cursor-pointer"
                      }`}
                      title={bloqueada ? "Apenas admin pode atribuir esta loja" : ""}
                    >
                      <input
                        type="checkbox"
                        checked={marcada}
                        disabled={bloqueada}
                        onChange={() => onToggleLoja(l.id)}
                        className="w-3.5 h-3.5 accent-red-700"
                      />
                      <span className="flex-1">
                        {l.nome}
                        {l.eh_escritorio && (
                          <span className="ml-1 text-[10px] text-red-700 font-semibold">★</span>
                        )}
                        {bloqueada && (
                          <span className="ml-1 text-[9px] text-stone-400">(só admin)</span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
              {!ehSomenteRH && (
                <p className="text-xs text-stone-500 mt-2">
                  <span className="text-red-700 font-semibold">★</span> Escritório libera os módulos administrativos
                </p>
              )}
            </div>

            {erroLinha && (
              <div className="bg-red-50 border border-red-200 rounded-md p-2 text-xs text-red-900">
                {erroLinha}
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                onClick={onSalvar}
                disabled={salvando || !draftGrupoId}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-emerald-700 text-white font-medium rounded-md hover:bg-emerald-800 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Salvar
              </button>
              <button
                onClick={onCancelar}
                disabled={salvando}
                className="px-3 py-2 text-sm text-stone-600 hover:text-stone-900"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Aba GRUPOS — criar/editar grupos e configurar permissões
// ============================================================

const MODULOS_PERMISSAO = [
  { id: "conciliacao", nome: "Conciliação dos Pedidos" },
  { id: "cores",       nome: "Tabela de Cores" },
  { id: "taxas",       nome: "Tabelas de Taxas" },
  { id: "financeiro",  nome: "Conciliação Financeira" },
];

const NIVEIS_PERMISSAO = [
  { id: "sem_acesso", nome: "Sem acesso", cor: "stone" },
  { id: "visualizar", nome: "Visualizar", cor: "amber" },
  { id: "editar",     nome: "Editar",     cor: "emerald" },
];

function GruposTab({ grupos, onChange }) {
  const [editando, setEditando] = useState(null); // grupo.id sendo editado
  const [draft, setDraft] = useState(null);
  const [adicionando, setAdicionando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erroLinha, setErroLinha] = useState(null);

  const iniciarEdicao = (g) => {
    setEditando(g.id);
    setErroLinha(null);
    setDraft({
      id: g.id,
      nome: g.nome,
      descricao: g.descricao || "",
      permissoes: { ...g.permissoes },
    });
  };

  const iniciarAdicao = () => {
    setAdicionando(true);
    setErroLinha(null);
    setDraft({
      nome: "",
      descricao: "",
      permissoes: { conciliacao: "sem_acesso", cores: "sem_acesso", taxas: "sem_acesso", financeiro: "sem_acesso" },
    });
  };

  const cancelar = () => {
    setEditando(null);
    setAdicionando(false);
    setDraft(null);
    setErroLinha(null);
  };

  const setPermissao = (modulo, nivel) => {
    setDraft((d) => ({ ...d, permissoes: { ...d.permissoes, [modulo]: nivel } }));
  };

  const salvar = async () => {
    if (!draft.nome.trim()) return;
    setSalvando(true);
    setErroLinha(null);
    try {
      if (adicionando) {
        const { error } = await supabase
          .from("grupos")
          .insert({ nome: draft.nome.trim(), descricao: draft.descricao.trim() || null, permissoes: draft.permissoes });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("grupos")
          .update({
            nome: draft.nome.trim(),
            descricao: draft.descricao.trim() || null,
            permissoes: draft.permissoes,
            updated_at: new Date().toISOString(),
          })
          .eq("id", draft.id);
        if (error) throw error;
      }
      cancelar();
      onChange();
    } catch (e) {
      if (e.message?.includes("policy") || e.code === "42501") {
        setErroLinha("Sem permissão. Apenas admin pode alterar grupos.");
      } else if (e.code === "23505") {
        setErroLinha("Já existe um grupo com esse nome.");
      } else {
        setErroLinha("Erro ao salvar: " + e.message);
      }
    } finally {
      setSalvando(false);
    }
  };

  const remover = async (g) => {
    if (!confirm(`Remover o grupo "${g.nome}"?\n\nUsuários neste grupo perderão acesso. Não pode desfazer.`)) return;
    setSalvando(true);
    try {
      const { error } = await supabase.from("grupos").delete().eq("id", g.id);
      if (error) {
        if (error.code === "23503") {
          alert("Não é possível remover este grupo porque há usuários nele. Remova os usuários primeiro.");
        } else {
          alert("Erro ao remover: " + error.message);
        }
        return;
      }
      onChange();
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="space-y-4">
      {!adicionando && !editando && (
        <button
          onClick={iniciarAdicao}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-red-700 text-white rounded-md hover:bg-red-800 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Novo grupo
        </button>
      )}

      {(adicionando || editando) && draft && (
        <GrupoEditor
          draft={draft}
          ehNovo={adicionando}
          erroLinha={erroLinha}
          salvando={salvando}
          onChangeNome={(v) => setDraft({ ...draft, nome: v })}
          onChangeDescricao={(v) => setDraft({ ...draft, descricao: v })}
          onSetPermissao={setPermissao}
          onSalvar={salvar}
          onCancelar={cancelar}
        />
      )}

      <div className="space-y-2">
        {grupos.map((g) => (
          <div key={g.id} className="border border-stone-200 bg-white rounded-lg p-4">
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="flex-1 min-w-0">
                <h3 className="font-serif text-base font-semibold text-stone-900">{g.nome}</h3>
                {g.descricao && <p className="text-xs text-stone-600 mt-0.5">{g.descricao}</p>}
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button
                  onClick={() => iniciarEdicao(g)}
                  disabled={editando || adicionando}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-red-800 border border-red-200 rounded-md hover:bg-red-50 disabled:opacity-40"
                >
                  <Pencil className="w-3 h-3" />
                  Editar
                </button>
                <button
                  onClick={() => remover(g)}
                  disabled={editando || adicionando || salvando}
                  className="p-1.5 text-stone-500 hover:bg-red-50 hover:text-red-700 rounded-md disabled:opacity-40"
                  title="Remover grupo"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mt-3">
              {MODULOS_PERMISSAO.map((m) => {
                const nivel = g.permissoes?.[m.id] || "sem_acesso";
                const corBg = nivel === "editar" ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                            : nivel === "visualizar" ? "bg-amber-50 border-amber-200 text-amber-800"
                            : "bg-stone-50 border-stone-200 text-stone-500";
                const labelNivel = nivel === "editar" ? "Editar"
                                 : nivel === "visualizar" ? "Visualizar" : "Sem acesso";
                return (
                  <div key={m.id} className={`text-xs border rounded px-2 py-1.5 ${corBg}`}>
                    <p className="font-medium truncate">{m.nome}</p>
                    <p className="text-[10px] opacity-80">{labelNivel}</p>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function GrupoEditor({ draft, ehNovo, erroLinha, salvando, onChangeNome, onChangeDescricao, onSetPermissao, onSalvar, onCancelar }) {
  return (
    <div className="border-2 border-red-300 bg-red-50/30 rounded-lg p-4 space-y-4">
      <h3 className="font-serif text-lg font-semibold text-stone-900">
        {ehNovo ? "Novo grupo" : "Editar grupo"}
      </h3>

      <div>
        <label className="text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1.5 block">
          Nome do grupo
        </label>
        <input
          type="text"
          value={draft.nome}
          onChange={(e) => onChangeNome(e.target.value)}
          placeholder="Ex: GERENTES"
          autoFocus
          className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-red-700/30 focus:border-red-700"
        />
      </div>

      <div>
        <label className="text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1.5 block">
          Descrição (opcional)
        </label>
        <input
          type="text"
          value={draft.descricao}
          onChange={(e) => onChangeDescricao(e.target.value)}
          placeholder="Ex: Equipe de gerentes"
          className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-red-700/30 focus:border-red-700"
        />
      </div>

      <div>
        <label className="text-xs font-semibold text-stone-700 uppercase tracking-wider mb-2 block">
          Permissões por módulo
        </label>
        <div className="space-y-2">
          {MODULOS_PERMISSAO.map((m) => (
            <div key={m.id} className="flex items-center gap-3 bg-white border border-stone-200 rounded-md p-2">
              <span className="flex-1 text-sm text-stone-800">{m.nome}</span>
              <div className="flex gap-1">
                {NIVEIS_PERMISSAO.map((n) => {
                  const ativo = draft.permissoes[m.id] === n.id;
                  return (
                    <button
                      key={n.id}
                      onClick={() => onSetPermissao(m.id, n.id)}
                      className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                        ativo
                          ? n.id === "editar" ? "bg-emerald-700 text-white"
                            : n.id === "visualizar" ? "bg-amber-600 text-white"
                            : "bg-stone-600 text-white"
                          : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                      }`}
                    >
                      {n.nome}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {erroLinha && (
        <div className="bg-red-50 border border-red-200 rounded-md p-2 text-xs text-red-900">
          {erroLinha}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={onSalvar}
          disabled={salvando || !draft.nome.trim()}
          className="flex items-center gap-1.5 px-4 py-2 text-sm bg-emerald-700 text-white font-medium rounded-md hover:bg-emerald-800 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Salvar
        </button>
        <button
          onClick={onCancelar}
          disabled={salvando}
          className="px-3 py-2 text-sm text-stone-600 hover:text-stone-900"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Aba LOJAS — criar/editar lojas
// ============================================================

function LojasTab({ lojas, onChange }) {
  const [editando, setEditando] = useState(null);
  const [draft, setDraft] = useState(null);
  const [adicionando, setAdicionando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erroLinha, setErroLinha] = useState(null);

  const iniciarEdicao = (l) => {
    setEditando(l.id);
    setErroLinha(null);
    setDraft({ id: l.id, nome: l.nome, eh_escritorio: l.eh_escritorio, ativa: l.ativa });
  };

  const iniciarAdicao = () => {
    setAdicionando(true);
    setErroLinha(null);
    setDraft({ nome: "", eh_escritorio: false, ativa: true });
  };

  const cancelar = () => {
    setEditando(null);
    setAdicionando(false);
    setDraft(null);
    setErroLinha(null);
  };

  const salvar = async () => {
    if (!draft.nome.trim()) return;
    setSalvando(true);
    setErroLinha(null);
    try {
      if (adicionando) {
        const { error } = await supabase
          .from("lojas")
          .insert({ nome: draft.nome.trim(), eh_escritorio: draft.eh_escritorio, ativa: draft.ativa });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("lojas")
          .update({
            nome: draft.nome.trim(),
            eh_escritorio: draft.eh_escritorio,
            ativa: draft.ativa,
            updated_at: new Date().toISOString(),
          })
          .eq("id", draft.id);
        if (error) throw error;
      }
      cancelar();
      onChange();
    } catch (e) {
      if (e.message?.includes("policy") || e.code === "42501") {
        setErroLinha("Sem permissão. Apenas admin pode alterar lojas.");
      } else if (e.code === "23505") {
        setErroLinha("Já existe uma loja com esse nome.");
      } else {
        setErroLinha("Erro ao salvar: " + e.message);
      }
    } finally {
      setSalvando(false);
    }
  };

  const remover = async (l) => {
    if (!confirm(`Remover a loja "${l.nome}"?\n\nUsuários ligados a esta loja perderão a associação.`)) return;
    setSalvando(true);
    try {
      const { error } = await supabase.from("lojas").delete().eq("id", l.id);
      if (error) {
        alert("Erro ao remover: " + error.message);
        return;
      }
      onChange();
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="space-y-4">
      {!adicionando && !editando && (
        <button
          onClick={iniciarAdicao}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-red-700 text-white rounded-md hover:bg-red-800 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Nova loja
        </button>
      )}

      {(adicionando || editando) && draft && (
        <div className="border-2 border-red-300 bg-red-50/30 rounded-lg p-4 space-y-3">
          <h3 className="font-serif text-lg font-semibold text-stone-900">
            {adicionando ? "Nova loja" : "Editar loja"}
          </h3>
          <div>
            <label className="text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1.5 block">
              Nome da loja
            </label>
            <input
              type="text"
              value={draft.nome}
              onChange={(e) => setDraft({ ...draft, nome: e.target.value })}
              placeholder="Ex: Loja de Bauru"
              autoFocus
              className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-red-700/30 focus:border-red-700"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.eh_escritorio}
              onChange={(e) => setDraft({ ...draft, eh_escritorio: e.target.checked })}
              className="w-4 h-4 accent-red-700"
            />
            <span>É o Escritório (libera módulos administrativos)</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.ativa}
              onChange={(e) => setDraft({ ...draft, ativa: e.target.checked })}
              className="w-4 h-4 accent-red-700"
            />
            <span>Loja ativa (desmarque pra desativar sem apagar)</span>
          </label>

          {erroLinha && (
            <div className="bg-red-50 border border-red-200 rounded-md p-2 text-xs text-red-900">
              {erroLinha}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button
              onClick={salvar}
              disabled={salvando || !draft.nome.trim()}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-emerald-700 text-white font-medium rounded-md hover:bg-emerald-800 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Salvar
            </button>
            <button
              onClick={cancelar}
              disabled={salvando}
              className="px-3 py-2 text-sm text-stone-600 hover:text-stone-900"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
        <div className="grid grid-cols-[1fr_120px_120px_auto] gap-3 px-4 py-2.5 bg-stone-50 border-b border-stone-200 text-[11px] uppercase tracking-wider font-semibold text-stone-600">
          <div>Nome</div>
          <div className="text-center">Escritório?</div>
          <div className="text-center">Ativa?</div>
          <div className="pr-2">Ações</div>
        </div>
        {lojas.map((l) => (
          <div key={l.id} className="grid grid-cols-[1fr_120px_120px_auto] gap-3 px-4 py-2.5 border-b border-stone-100 items-center">
            <div className="text-sm text-stone-800 font-medium">
              {l.nome}
              {l.eh_escritorio && (
                <span className="ml-2 text-[10px] text-red-700 font-semibold">★</span>
              )}
            </div>
            <div className="text-center text-xs">
              {l.eh_escritorio ? <span className="text-red-700 font-semibold">SIM</span> : <span className="text-stone-400">—</span>}
            </div>
            <div className="text-center text-xs">
              {l.ativa ? <span className="text-emerald-700 font-semibold">SIM</span> : <span className="text-red-700">NÃO</span>}
            </div>
            <div className="flex items-center gap-1 pr-1">
              <button
                onClick={() => iniciarEdicao(l)}
                disabled={editando || adicionando}
                className="p-1.5 text-stone-500 hover:bg-stone-100 hover:text-stone-900 rounded disabled:opacity-40"
                title="Editar"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => remover(l)}
                disabled={editando || adicionando || salvando}
                className="p-1.5 text-stone-500 hover:bg-red-50 hover:text-red-700 rounded disabled:opacity-40"
                title="Remover"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TrocaSenhaModal({ onFechar }) {
  const [senhaAtual, setSenhaAtual] = useState("");
  const [senhaNova, setSenhaNova] = useState("");
  const [confirmarSenha, setConfirmarSenha] = useState("");
  const [erro, setErro] = useState(null);
  const [sucesso, setSucesso] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const trocar = async () => {
    setErro(null);
    if (senhaNova.length < 6) {
      setErro("A nova senha precisa ter no mínimo 6 caracteres.");
      return;
    }
    if (senhaNova !== confirmarSenha) {
      setErro("A confirmação da senha não bate. Digite de novo.");
      return;
    }
    if (senhaNova === senhaAtual) {
      setErro("A nova senha precisa ser diferente da atual.");
      return;
    }
    setSalvando(true);
    try {
      // 1) Verifica senha atual fazendo um signIn (não precisa fazer logout)
      const { data: sessao } = await supabase.auth.getSession();
      const email = sessao?.session?.user?.email;
      if (!email) {
        setErro("Sessão expirada. Faça login de novo.");
        return;
      }
      const { error: errSignIn } = await supabase.auth.signInWithPassword({
        email,
        password: senhaAtual,
      });
      if (errSignIn) {
        setErro("Senha atual incorreta.");
        return;
      }
      // 2) Atualiza pra nova senha
      const { error: errUpd } = await supabase.auth.updateUser({ password: senhaNova });
      if (errUpd) {
        setErro("Erro ao trocar senha: " + errUpd.message);
        return;
      }
      setSucesso(true);
      setSenhaAtual("");
      setSenhaNova("");
      setConfirmarSenha("");
    } catch (e) {
      setErro("Erro inesperado: " + e.message);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
    >
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-md p-6">
        <div className="flex items-start justify-between mb-4">
          <h2 className="font-serif text-xl font-bold text-stone-900">Trocar minha senha</h2>
          <button onClick={onFechar} className="p-1 text-stone-500 hover:bg-stone-100 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        {sucesso ? (
          <div className="space-y-4">
            <div className="bg-emerald-50 border border-emerald-200 rounded-md p-3 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-700 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-emerald-900">
                Senha trocada com sucesso! Você continua logada na sessão atual.
              </p>
            </div>
            <button
              onClick={onFechar}
              className="w-full px-4 py-2 text-sm bg-stone-100 text-stone-700 rounded-md hover:bg-stone-200"
            >
              Fechar
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1.5 block">
                Senha atual
              </label>
              <input
                type="password"
                value={senhaAtual}
                onChange={(e) => setSenhaAtual(e.target.value)}
                autoFocus
                className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-red-700/30 focus:border-red-700"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1.5 block">
                Nova senha (mínimo 6 caracteres)
              </label>
              <input
                type="password"
                value={senhaNova}
                onChange={(e) => setSenhaNova(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-red-700/30 focus:border-red-700"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1.5 block">
                Confirmar nova senha
              </label>
              <input
                type="password"
                value={confirmarSenha}
                onChange={(e) => setConfirmarSenha(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") trocar(); }}
                className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-red-700/30 focus:border-red-700"
              />
            </div>

            {erro && (
              <div className="bg-red-50 border border-red-200 rounded-md p-2 text-xs text-red-900">
                {erro}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={trocar}
                disabled={salvando || !senhaAtual || !senhaNova || !confirmarSenha}
                className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 text-sm bg-red-700 text-white font-medium rounded-md hover:bg-red-800 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Trocar senha
              </button>
              <button
                onClick={onFechar}
                disabled={salvando}
                className="px-3 py-2 text-sm text-stone-600 hover:text-stone-900"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// BUSCA GLOBAL — busca em módulos, funcionários, cores e taxas
// ============================================================

function GlobalSearchBar({ userCtx, onNavegar, colorTable, taxasBlu, taxasPV }) {
  const [query, setQuery] = useState("");
  const [aberto, setAberto] = useState(false);
  const [usuarios, setUsuarios] = useState([]);
  const [carregouUsuarios, setCarregouUsuarios] = useState(false);
  const inputRef = useRef(null);
  const containerRef = useRef(null);

  // Carrega usuários sob demanda (só admin/RH)
  // Se for RH (não admin), esconde usuários que estão no Escritório
  useEffect(() => {
    if (!aberto) return;
    if (carregouUsuarios) return;
    if (!userCtx.isAdmin && !userCtx.isRH) return;
    (async () => {
      try {
        // Busca usuários e lojas em paralelo (precisamos das lojas pra saber qual é o Escritório)
        const [resUsuarios, resLojas] = await Promise.all([
          supabase
            .from("vw_usuarios_completo")
            .select("user_id, email, grupo_nome, lojas_ids, lojas_nomes"),
          supabase
            .from("lojas")
            .select("id, eh_escritorio"),
        ]);
        let lista = resUsuarios.data || [];

        // Se for somente RH (não admin), filtra fora os usuários do Escritório
        const ehSomenteRH = userCtx.isRH && !userCtx.isAdmin;
        if (ehSomenteRH && resLojas.data) {
          const escritorioIds = resLojas.data
            .filter((l) => l.eh_escritorio)
            .map((l) => l.id);
          lista = lista.filter((u) => {
            const lojas = u.lojas_ids || [];
            return !lojas.some((id) => escritorioIds.includes(id));
          });
        }

        setUsuarios(lista);
        setCarregouUsuarios(true);
      } catch (e) {
        console.error("[GlobalSearch] Erro ao carregar usuários:", e);
      }
    })();
  }, [aberto, carregouUsuarios, userCtx.isAdmin, userCtx.isRH]);

  // Fecha se clicar fora
  useEffect(() => {
    if (!aberto) return;
    const onClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setAberto(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [aberto]);

  // Atalho Ctrl/Cmd+K
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setAberto(true);
      }
      if (e.key === "Escape" && aberto) {
        setAberto(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [aberto]);

  // Normaliza pra busca (remove acento, minúsculas)
  const norm = (s) =>
    String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

  // Calcula resultados em tempo real
  const resultados = useMemo(() => {
    const q = norm(query.trim());
    if (q.length < 2) return null;

    const out = {
      modulos: [],
      funcionarios: [],
      cores: [],
      taxas: [],
    };

    // ===== 1. MÓDULOS (com palavras-chave) =====
    const modulosBase = [
      {
        id: "conciliacao",
        nome: "Conciliação dos Pedidos",
        keywords: ["conciliacao", "conciliação", "pedidos", "negativos", "sistema", "administrativo", "casar", "comparar"],
        aba: "Administrativo",
        visivel: userCtx.estaNoEscritorio && podeVerModulo(userCtx.permissoes, "conciliacao"),
      },
      {
        id: "cores",
        nome: "Tabela de Cores",
        keywords: ["cores", "cor", "tabela", "produtos", "skus", "modelos", "administrativo"],
        aba: "Administrativo",
        visivel: userCtx.estaNoEscritorio && podeVerModulo(userCtx.permissoes, "cores"),
      },
      {
        id: "financeiro",
        nome: "Conciliação Financeira",
        keywords: ["financeiro", "conciliacao", "conciliação", "banco", "extrato", "vendas", "blu", "pague", "veloz", "pix", "cartao", "cartão"],
        aba: "Financeiro",
        visivel: userCtx.estaNoEscritorio && podeVerModulo(userCtx.permissoes, "financeiro"),
      },
      {
        id: "taxas",
        nome: "Tabelas de Taxas de Cartões",
        keywords: ["taxas", "taxa", "cartoes", "cartões", "cartao", "credito", "crédito", "debito", "débito", "blu", "pague", "veloz", "parcelas", "bandeiras", "visa", "mastercard", "elo", "amex", "hipercard", "pix", "financeiro"],
        aba: "Financeiro",
        visivel: userCtx.estaNoEscritorio && podeVerModulo(userCtx.permissoes, "taxas"),
      },
      {
        id: "permissoes",
        nome: userCtx.isRH && !userCtx.isAdmin ? "Cadastro de Funcionários" : "Gerenciar Permissões",
        keywords: ["permissoes", "permissões", "permissao", "permissão", "usuarios", "usuários", "usuario", "funcionarios", "funcionários", "cadastrar", "grupos", "lojas", "rh", "admin", "acesso"],
        aba: null,
        visivel: userCtx.isAdmin || userCtx.isRH,
      },
    ];

    for (const m of modulosBase) {
      if (!m.visivel) continue;
      const nomeMatch = norm(m.nome).includes(q);
      const kwMatch = m.keywords.some((k) => norm(k).includes(q));
      const abaMatch = m.aba && norm(m.aba).includes(q);
      if (nomeMatch || kwMatch || abaMatch) {
        out.modulos.push(m);
      }
    }

    // ===== 2. FUNCIONÁRIOS (só admin/RH) =====
    if (userCtx.isAdmin || userCtx.isRH) {
      for (const u of usuarios) {
        const emailMatch = norm(u.email).includes(q);
        const grupoMatch = norm(u.grupo_nome).includes(q);
        const lojasMatch = norm(u.lojas_nomes || "").includes(q);
        if (emailMatch || grupoMatch || lojasMatch) {
          out.funcionarios.push(u);
        }
        if (out.funcionarios.length >= 8) break;
      }
    }

    // ===== 3. CORES =====
    if (userCtx.estaNoEscritorio && podeVerModulo(userCtx.permissoes, "cores") && colorTable) {
      // colorTable tem estrutura: { [marketplace]: [{cor, codigos: [...]}, ...] }
      // ou pode ser uma estrutura diferente — vamos tentar genérico
      try {
        const procurar = (obj, profundidade = 0) => {
          if (profundidade > 5) return; // limite de segurança
          if (out.cores.length >= 8) return;
          if (typeof obj === "string") {
            if (norm(obj).includes(q)) {
              if (!out.cores.find((c) => c.label === obj)) {
                out.cores.push({ label: obj });
              }
            }
          } else if (Array.isArray(obj)) {
            for (const item of obj) procurar(item, profundidade + 1);
          } else if (obj && typeof obj === "object") {
            for (const v of Object.values(obj)) procurar(v, profundidade + 1);
          }
        };
        procurar(colorTable);
      } catch (e) {
        console.error("[GlobalSearch] Erro buscando em cores:", e);
      }
    }

    // ===== 4. TAXAS =====
    if (userCtx.estaNoEscritorio && podeVerModulo(userCtx.permissoes, "taxas")) {
      const buscarEmTaxas = (taxas, banco) => {
        if (!taxas) return;
        try {
          const procurar = (obj, profundidade = 0, caminho = "") => {
            if (profundidade > 5) return;
            if (out.taxas.length >= 8) return;
            if (typeof obj === "string") {
              if (norm(obj).includes(q)) {
                if (!out.taxas.find((t) => t.label === obj && t.banco === banco)) {
                  out.taxas.push({ label: obj, banco, caminho });
                }
              }
            } else if (Array.isArray(obj)) {
              obj.forEach((item, i) => procurar(item, profundidade + 1, caminho));
            } else if (obj && typeof obj === "object") {
              for (const [k, v] of Object.entries(obj)) {
                if (norm(k).includes(q) && profundidade > 0) {
                  if (!out.taxas.find((t) => t.label === k && t.banco === banco)) {
                    out.taxas.push({ label: k, banco, caminho });
                  }
                }
                procurar(v, profundidade + 1, caminho ? `${caminho} › ${k}` : k);
              }
            }
          };
          procurar(taxas);
        } catch (e) {
          console.error("[GlobalSearch] Erro buscando em taxas:", e);
        }
      };
      buscarEmTaxas(taxasBlu, "Blu");
      buscarEmTaxas(taxasPV, "Pague Veloz");
    }

    return out;
  }, [query, userCtx, colorTable, taxasBlu, taxasPV, usuarios]);

  const totalResultados =
    (resultados?.modulos.length || 0) +
    (resultados?.funcionarios.length || 0) +
    (resultados?.cores.length || 0) +
    (resultados?.taxas.length || 0);

  const irPara = (rota) => {
    setAberto(false);
    setQuery("");
    onNavegar(rota);
  };

  return (
    <div ref={containerRef} className="relative flex-1 max-w-md">
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/70 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setAberto(true);
          }}
          onFocus={() => setAberto(true)}
          placeholder="Buscar... (Ctrl+K)"
          className="w-full pl-9 pr-9 py-2 text-sm rounded-md bg-white/15 hover:bg-white/20 focus:bg-white/25 border border-white/20 text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-white/40 transition-colors"
        />
        {query && (
          <button
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-white/70 hover:text-white hover:bg-white/10 rounded"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Dropdown de resultados */}
      {aberto && resultados && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-lg shadow-2xl border border-stone-200 max-h-[70vh] overflow-y-auto z-50">
          {totalResultados === 0 ? (
            <div className="p-4 text-center text-sm text-stone-500">
              {query.trim().length < 2
                ? "Digite ao menos 2 letras pra buscar..."
                : `Nada encontrado pra "${query}"`}
            </div>
          ) : (
            <div className="py-2">
              {/* Módulos */}
              {resultados.modulos.length > 0 && (
                <div className="mb-2">
                  <p className="text-[10px] uppercase tracking-[0.15em] text-stone-500 font-semibold px-3 py-1.5">
                    Módulos
                  </p>
                  {resultados.modulos.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => irPara(m.id)}
                      className="w-full flex items-center gap-3 px-3 py-2 text-sm text-left hover:bg-red-50 transition-colors"
                    >
                      <ChevronRight className="w-3.5 h-3.5 text-red-700 flex-shrink-0" />
                      <span className="flex-1 text-stone-900">{m.nome}</span>
                      {m.aba && (
                        <span className="text-[10px] uppercase tracking-wider text-stone-500">
                          {m.aba}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {/* Funcionários */}
              {resultados.funcionarios.length > 0 && (
                <div className="mb-2 border-t border-stone-100 pt-2">
                  <p className="text-[10px] uppercase tracking-[0.15em] text-stone-500 font-semibold px-3 py-1.5">
                    Funcionários
                  </p>
                  {resultados.funcionarios.map((u) => (
                    <button
                      key={u.user_id}
                      onClick={() => irPara("permissoes")}
                      className="w-full flex items-start gap-3 px-3 py-2 text-sm text-left hover:bg-red-50 transition-colors"
                    >
                      <Users className="w-3.5 h-3.5 text-amber-700 flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-stone-900 truncate">{u.email}</p>
                        <p className="text-[10px] text-stone-500 truncate">
                          {u.grupo_nome}
                          {u.lojas_nomes && ` • ${u.lojas_nomes}`}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Cores */}
              {resultados.cores.length > 0 && (
                <div className="mb-2 border-t border-stone-100 pt-2">
                  <p className="text-[10px] uppercase tracking-[0.15em] text-stone-500 font-semibold px-3 py-1.5">
                    Cores
                  </p>
                  {resultados.cores.slice(0, 8).map((c, i) => (
                    <button
                      key={i}
                      onClick={() => irPara("cores")}
                      className="w-full flex items-center gap-3 px-3 py-2 text-sm text-left hover:bg-red-50 transition-colors"
                    >
                      <Palette className="w-3.5 h-3.5 text-pink-600 flex-shrink-0" />
                      <span className="flex-1 text-stone-900">{c.label}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Taxas */}
              {resultados.taxas.length > 0 && (
                <div className="mb-2 border-t border-stone-100 pt-2">
                  <p className="text-[10px] uppercase tracking-[0.15em] text-stone-500 font-semibold px-3 py-1.5">
                    Taxas
                  </p>
                  {resultados.taxas.slice(0, 8).map((t, i) => (
                    <button
                      key={i}
                      onClick={() => irPara("taxas")}
                      className="w-full flex items-center gap-3 px-3 py-2 text-sm text-left hover:bg-red-50 transition-colors"
                    >
                      <CreditCard className="w-3.5 h-3.5 text-emerald-700 flex-shrink-0" />
                      <span className="flex-1 text-stone-900">{t.label}</span>
                      <span className="text-[10px] uppercase tracking-wider text-stone-500">
                        {t.banco}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// MÓDULO PEDIDO DE VENDA - Cadastro de Clientes
// ============================================================

// ----- Validadores e formatadores -----

// Remove tudo que não é dígito
function soNumeros(s) {
  return String(s || "").replace(/\D/g, "");
}

// Valida CPF (11 dígitos + dígitos verificadores)
function validarCPF(cpf) {
  const n = soNumeros(cpf);
  if (n.length !== 11) return false;
  // Rejeita CPFs com todos os dígitos iguais (ex: 11111111111)
  if (/^(\d)\1+$/.test(n)) return false;
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += parseInt(n[i]) * (10 - i);
  let resto = (soma * 10) % 11;
  if (resto === 10) resto = 0;
  if (resto !== parseInt(n[9])) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += parseInt(n[i]) * (11 - i);
  resto = (soma * 10) % 11;
  if (resto === 10) resto = 0;
  if (resto !== parseInt(n[10])) return false;
  return true;
}

// Valida CNPJ (14 dígitos + dígitos verificadores)
function validarCNPJ(cnpj) {
  const n = soNumeros(cnpj);
  if (n.length !== 14) return false;
  if (/^(\d)\1+$/.test(n)) return false;
  const calc = (base, pesos) => {
    let soma = 0;
    for (let i = 0; i < pesos.length; i++) soma += parseInt(base[i]) * pesos[i];
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const p2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const d1 = calc(n.slice(0, 12), p1);
  if (d1 !== parseInt(n[12])) return false;
  const d2 = calc(n.slice(0, 13), p2);
  if (d2 !== parseInt(n[13])) return false;
  return true;
}

// Valida e-mail simples
function validarEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(String(email || "").trim());
}

// Valida telefone brasileiro (10 ou 11 dígitos)
function validarTelefone(tel) {
  const n = soNumeros(tel);
  if (n.length !== 10 && n.length !== 11) return false;
  // DDD válido: 11–99 (não pode começar com 0)
  const ddd = parseInt(n.slice(0, 2));
  if (ddd < 11 || ddd > 99) return false;
  // Celular (11 dígitos) deve começar com 9 no terceiro dígito
  if (n.length === 11 && n[2] !== "9") return false;
  return true;
}

// Formata CPF: 123.456.789-00
function formatarCPF(s) {
  const n = soNumeros(s).slice(0, 11);
  if (n.length <= 3) return n;
  if (n.length <= 6) return `${n.slice(0,3)}.${n.slice(3)}`;
  if (n.length <= 9) return `${n.slice(0,3)}.${n.slice(3,6)}.${n.slice(6)}`;
  return `${n.slice(0,3)}.${n.slice(3,6)}.${n.slice(6,9)}-${n.slice(9)}`;
}

// Formata CNPJ: 12.345.678/0001-99
function formatarCNPJ(s) {
  const n = soNumeros(s).slice(0, 14);
  if (n.length <= 2) return n;
  if (n.length <= 5) return `${n.slice(0,2)}.${n.slice(2)}`;
  if (n.length <= 8) return `${n.slice(0,2)}.${n.slice(2,5)}.${n.slice(5)}`;
  if (n.length <= 12) return `${n.slice(0,2)}.${n.slice(2,5)}.${n.slice(5,8)}/${n.slice(8)}`;
  return `${n.slice(0,2)}.${n.slice(2,5)}.${n.slice(5,8)}/${n.slice(8,12)}-${n.slice(12)}`;
}

// Formata telefone: (11) 91234-5678 ou (11) 1234-5678
function formatarTelefone(s) {
  const n = soNumeros(s).slice(0, 11);
  if (n.length <= 2) return n.length ? `(${n}` : "";
  if (n.length <= 6) return `(${n.slice(0,2)}) ${n.slice(2)}`;
  if (n.length <= 10) return `(${n.slice(0,2)}) ${n.slice(2,6)}-${n.slice(6)}`;
  return `(${n.slice(0,2)}) ${n.slice(2,7)}-${n.slice(7)}`;
}

// Formata CEP: 12345-678
function formatarCEP(s) {
  const n = soNumeros(s).slice(0, 8);
  if (n.length <= 5) return n;
  return `${n.slice(0,5)}-${n.slice(5)}`;
}

// ----- Hook que carrega/persiste clientes no Supabase -----

function useClientes(user) {
  const [clientes, setClientes] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);

  const carregar = useCallback(async () => {
    setError(null);
    try {
      const { data, error: e } = await supabase
        .from("clientes")
        .select("*")
        .order("nome");
      if (e) throw e;
      setClientes(data || []);
    } catch (e) {
      console.error("[useClientes] Erro:", e);
      setError(e.message);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const salvar = async (cliente) => {
    const payload = {
      nome:               cliente.nome.trim(),
      tipo_documento:     cliente.tipoDocumento,
      documento:          soNumeros(cliente.documento),
      // Inscrição Estadual: só envia quando for CNPJ. Se for vazio, salva NULL.
      inscricao_estadual: cliente.tipoDocumento === "cnpj"
                            ? (cliente.inscricaoEstadual?.trim() || null)
                            : null,
      email:              cliente.email.trim().toLowerCase(),
      telefone:           soNumeros(cliente.telefone),
      telefone_2:         cliente.telefone2 ? soNumeros(cliente.telefone2) : null,
      cep:                soNumeros(cliente.cep),
      endereco:           cliente.endereco.trim(),
      numero:             cliente.numero.trim(),
      bairro:             cliente.bairro.trim(),
      cidade:             cliente.cidade.trim(),
      estado:             cliente.estado.trim().toUpperCase(),
      tipo_moradia:       cliente.tipoMoradia,
      bloco:              cliente.tipoMoradia === "apartamento" ? cliente.bloco?.trim() || null : null,
      andar:              cliente.tipoMoradia === "apartamento" ? cliente.andar?.trim() || null : null,
    };

    if (cliente.id) {
      // Update
      payload.updated_at = new Date().toISOString();
      const { data, error: e } = await supabase
        .from("clientes")
        .update(payload)
        .eq("id", cliente.id)
        .select()
        .single();
      if (e) throw e;
      await carregar();
      return data;
    } else {
      // Insert
      payload.created_by = user?.id || null;
      const { data, error: e } = await supabase
        .from("clientes")
        .insert(payload)
        .select()
        .single();
      if (e) throw e;
      await carregar();
      return data;
    }
  };

  const remover = async (id) => {
    const { error: e } = await supabase.from("clientes").delete().eq("id", id);
    if (e) throw e;
    await carregar();
  };

  return { clientes, loaded, error, salvar, remover, reload: carregar };
}

// ============================================================
// MÓDULO PRINCIPAL — tela com 2 botões → cadastro / pesquisa
// ============================================================

function PedidoVendaModule({ user }) {
  // Tela ativa: "inicial" | "cadastro" | "pesquisa"
  const [tela, setTela] = useState("inicial");
  // Cliente sendo editado (null = novo cadastro)
  const [clienteEdicao, setClienteEdicao] = useState(null);
  // Pop-up depois de salvar: "Deseja fazer pedido?"
  const [perguntaPedido, setPerguntaPedido] = useState(null); // { cliente }
  // Mensagem "Em construção" ao confirmar pedido
  const [mostrarEmConstrucao, setMostrarEmConstrucao] = useState(false);
  // Cliente já cadastrado detectado durante o cadastro de novo
  const [clienteJaExiste, setClienteJaExiste] = useState(null);

  const { clientes, loaded, error, salvar, remover } = useClientes(user);

  const irParaCadastro = (cliente = null) => {
    setClienteEdicao(cliente);
    setTela("cadastro");
  };

  const apósSalvar = (clienteSalvo) => {
    setTela("inicial");
    setClienteEdicao(null);
    setPerguntaPedido({ cliente: clienteSalvo });
  };

  return (
    <div className="max-w-5xl mx-auto">
      {/* Cabeçalho */}
      <div className="mb-8 border-b border-stone-200 pb-6">
        <div className="flex items-baseline gap-3 mb-2">
          <span className="text-xs uppercase tracking-[0.2em] text-red-700 font-semibold">
            Vendas
          </span>
          <span className="text-stone-300">—</span>
          <span className="text-xs uppercase tracking-wider text-stone-500">
            Pedido de Venda
          </span>
        </div>
        <h1 className="font-serif text-4xl font-bold text-stone-900 tracking-tight">
          {tela === "cadastro"
            ? clienteEdicao ? "Editar Cliente" : "Novo Cliente"
            : tela === "pesquisa"
            ? "Pesquisar Cliente"
            : "Pedido de Venda"}
        </h1>
        {tela === "inicial" && (
          <p className="text-stone-600 mt-2">
            Comece cadastrando um novo cliente ou pesquisando um cliente já cadastrado.
          </p>
        )}
      </div>

      {/* Erro de conexão */}
      {error && tela === "inicial" && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-700 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-900">Erro ao carregar clientes: {error}</p>
        </div>
      )}

      {/* TELA INICIAL - 2 botões */}
      {tela === "inicial" && (
        <div className="grid md:grid-cols-2 gap-4 max-w-2xl mx-auto py-8">
          <button
            onClick={() => irParaCadastro(null)}
            className="bg-white border-2 border-red-200 hover:border-red-500 rounded-xl p-8 text-center transition-all hover:shadow-lg hover:-translate-y-0.5 group"
          >
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-50 group-hover:bg-red-100 mb-4 transition-colors">
              <Plus className="w-8 h-8 text-red-700" />
            </div>
            <h2 className="font-serif text-xl font-semibold text-stone-900 mb-1">
              Novo Cliente
            </h2>
            <p className="text-sm text-stone-600">
              Cadastrar um cliente novo do zero
            </p>
          </button>

          <button
            onClick={() => setTela("pesquisa")}
            className="bg-white border-2 border-stone-200 hover:border-red-500 rounded-xl p-8 text-center transition-all hover:shadow-lg hover:-translate-y-0.5 group"
          >
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-stone-100 group-hover:bg-red-100 mb-4 transition-colors">
              <Search className="w-8 h-8 text-stone-700 group-hover:text-red-700 transition-colors" />
            </div>
            <h2 className="font-serif text-xl font-semibold text-stone-900 mb-1">
              Pesquisar Cliente
            </h2>
            <p className="text-sm text-stone-600">
              {loaded
                ? `${clientes.length} cliente${clientes.length === 1 ? "" : "s"} cadastrado${clientes.length === 1 ? "" : "s"}`
                : "Carregando..."}
            </p>
          </button>
        </div>
      )}

      {/* TELA CADASTRO */}
      {tela === "cadastro" && (
        <ClienteFormulario
          clienteInicial={clienteEdicao}
          onSalvar={async (c) => {
            const salvo = await salvar(c);
            apósSalvar(salvo);
          }}
          onCancelar={() => { setTela("inicial"); setClienteEdicao(null); }}
          onClienteJaExiste={(c) => setClienteJaExiste(c)}
        />
      )}

      {/* TELA PESQUISA */}
      {tela === "pesquisa" && (
        <ClientePesquisa
          clientes={clientes}
          loaded={loaded}
          onVoltar={() => setTela("inicial")}
          onEditar={(c) => irParaCadastro(c)}
          onRemover={async (c) => {
            if (!confirm(`Remover o cliente "${c.nome}"?\n\nEssa ação não pode ser desfeita.`)) return;
            try {
              await remover(c.id);
            } catch (e) {
              alert("Erro ao remover: " + e.message);
            }
          }}
          onFazerPedido={(c) => setPerguntaPedido({ cliente: c })}
        />
      )}

      {/* POP-UP "Deseja fazer pedido?" */}
      {perguntaPedido && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
        >
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-700" />
              <h2 className="font-serif text-xl font-bold text-stone-900">
                Cadastro salvo!
              </h2>
            </div>
            <p className="text-sm text-stone-700 mb-1">
              <strong>{perguntaPedido.cliente?.nome}</strong> foi salvo com sucesso.
            </p>
            <p className="text-sm text-stone-700 mb-5">
              Deseja fazer um pedido para esse cliente agora?
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setPerguntaPedido(null)}
                className="px-4 py-2 text-sm text-stone-600 hover:bg-stone-100 rounded-md transition-colors"
              >
                Não, depois
              </button>
              <button
                onClick={() => {
                  setPerguntaPedido(null);
                  setMostrarEmConstrucao(true);
                }}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-red-700 text-white font-medium rounded-md hover:bg-red-800 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
                Sim, fazer pedido
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pop-up "Em construção" */}
      {mostrarEmConstrucao && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
        >
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-md p-6 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-amber-50 mb-3">
              <Settings className="w-8 h-8 text-amber-700" />
            </div>
            <h2 className="font-serif text-xl font-bold text-stone-900 mb-2">
              Em construção
            </h2>
            <p className="text-sm text-stone-700 mb-5">
              A tela de fazer pedido ainda está sendo desenvolvida. Por enquanto, o cadastro do cliente já foi salvo!
            </p>
            <button
              onClick={() => setMostrarEmConstrucao(false)}
              className="px-4 py-2 text-sm bg-stone-100 text-stone-700 rounded-md hover:bg-stone-200"
            >
              Entendi
            </button>
          </div>
        </div>
      )}

      {/* Pop-up "Cliente já cadastrado" — aparece quando o vendedor digita
          um documento que já está no banco */}
      {clienteJaExiste && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
        >
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-lg p-6">
            <div className="flex items-start gap-3 mb-4">
              <div className="flex-shrink-0 inline-flex items-center justify-center w-12 h-12 rounded-full bg-amber-50">
                <AlertTriangle className="w-6 h-6 text-amber-700" />
              </div>
              <div>
                <h2 className="font-serif text-xl font-bold text-stone-900 mb-1">
                  Cliente já cadastrado
                </h2>
                <p className="text-sm text-stone-700">
                  Este {clienteJaExiste.tipo_documento.toUpperCase()} já está no nosso sistema. Não precisa cadastrar de novo!
                </p>
              </div>
            </div>

            {/* Card com dados do cliente existente */}
            <div className="bg-stone-50 border border-stone-200 rounded-lg p-4 mb-4">
              <div className="flex items-start gap-3">
                {clienteJaExiste.numero_cliente && (
                  <div className="flex-shrink-0 text-[10px] uppercase tracking-wider text-stone-400 font-semibold pt-0.5">
                    <div>Nº</div>
                    <div className="text-stone-700 text-sm font-bold leading-tight">
                      {clienteJaExiste.numero_cliente}
                    </div>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <h3 className="font-serif text-base font-semibold text-stone-900 mb-1">
                    {clienteJaExiste.nome}
                  </h3>
                  <div className="text-xs text-stone-600 space-y-0.5">
                    <p>
                      {clienteJaExiste.tipo_documento.toUpperCase()}:{" "}
                      <strong className="text-stone-900">
                        {clienteJaExiste.tipo_documento === "cnpj"
                          ? formatarCNPJ(clienteJaExiste.documento)
                          : formatarCPF(clienteJaExiste.documento)}
                      </strong>
                    </p>
                    <p>📧 {clienteJaExiste.email}</p>
                    <p>📞 {formatarTelefone(clienteJaExiste.telefone)}</p>
                    <p>📍 {clienteJaExiste.endereco}, {clienteJaExiste.numero} — {clienteJaExiste.bairro}, {clienteJaExiste.cidade}/{clienteJaExiste.estado}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Botões de ação */}
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                onClick={() => {
                  // É este cliente: vai pra tela de fazer pedido
                  const c = clienteJaExiste;
                  setClienteJaExiste(null);
                  setTela("inicial");
                  setClienteEdicao(null);
                  setPerguntaPedido({ cliente: c });
                }}
                className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 text-sm bg-red-700 text-white font-medium rounded-md hover:bg-red-800"
              >
                <ChevronRight className="w-4 h-4" />
                É este cliente
              </button>
              <button
                onClick={() => {
                  // Editar dados: abre formulário com tudo preenchido
                  const c = clienteJaExiste;
                  setClienteJaExiste(null);
                  setClienteEdicao(c);
                  setTela("cadastro");
                }}
                className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium text-red-800 border border-red-200 rounded-md hover:bg-red-50"
              >
                <Pencil className="w-4 h-4" />
                Editar dados
              </button>
              <button
                onClick={() => {
                  setClienteJaExiste(null);
                  setTela("inicial");
                  setClienteEdicao(null);
                }}
                className="px-4 py-2 text-sm text-stone-600 hover:text-stone-900"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// FORMULÁRIO DE CADASTRO/EDIÇÃO DE CLIENTE
// ============================================================

function ClienteFormulario({ clienteInicial, onSalvar, onCancelar, onClienteJaExiste }) {
  // Estado do formulário (com formatação aplicada nos campos visuais)
  const [form, setForm] = useState(() => {
    if (clienteInicial) {
      return {
        id:                 clienteInicial.id,
        nome:               clienteInicial.nome || "",
        tipoDocumento:      clienteInicial.tipo_documento || "cpf",
        documento:          clienteInicial.tipo_documento === "cnpj"
                              ? formatarCNPJ(clienteInicial.documento)
                              : formatarCPF(clienteInicial.documento),
        inscricaoEstadual:  clienteInicial.inscricao_estadual || "",
        email:              clienteInicial.email || "",
        telefone:           formatarTelefone(clienteInicial.telefone || ""),
        telefone2:          formatarTelefone(clienteInicial.telefone_2 || ""),
        cep:                formatarCEP(clienteInicial.cep || ""),
        endereco:           clienteInicial.endereco || "",
        numero:             clienteInicial.numero || "",
        bairro:             clienteInicial.bairro || "",
        cidade:             clienteInicial.cidade || "",
        estado:             clienteInicial.estado || "",
        tipoMoradia:        clienteInicial.tipo_moradia || "casa",
        bloco:              clienteInicial.bloco || "",
        andar:              clienteInicial.andar || "",
      };
    }
    return {
      id: null,
      nome: "", tipoDocumento: "cpf", documento: "", inscricaoEstadual: "", email: "",
      telefone: "", telefone2: "",
      cep: "", endereco: "", numero: "", bairro: "", cidade: "", estado: "",
      tipoMoradia: "casa", bloco: "", andar: "",
    };
  });

  const [erros, setErros] = useState({});
  const [erroGeral, setErroGeral] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [buscandoCEP, setBuscandoCEP] = useState(false);

  // ETAPA Mapa: verifica se o endereço existe no OpenStreetMap
  // Estados possíveis:
  //   "ocioso"       — ainda não verificou
  //   "verificando"  — chamando a API
  //   "encontrado"   — endereço foi achado no mapa
  //   "nao_encontrado" — não foi achado (mostra alerta amarelo)
  //   "erro"         — falha de rede
  const [statusMapa, setStatusMapa] = useState("ocioso");
  const [enderecoEncontrado, setEnderecoEncontrado] = useState(null); // texto retornado pelo OSM

  const setCampo = (campo, valor) => {
    setForm((f) => ({ ...f, [campo]: valor }));
    // Limpa o erro do campo quando o usuário edita
    setErros((e) => ({ ...e, [campo]: undefined }));
    setErroGeral(null);
  };

  // Validação completa antes de salvar
  const validar = () => {
    const e = {};

    if (!form.nome.trim()) {
      e.nome = form.tipoDocumento === "cnpj"
        ? "Razão Social é obrigatória."
        : "Nome é obrigatório.";
    } else if (form.nome.trim().length < 2) {
      e.nome = form.tipoDocumento === "cnpj"
        ? "Razão Social muito curta."
        : "Nome muito curto.";
    }

    if (!form.documento.trim()) {
      e.documento = `${form.tipoDocumento.toUpperCase()} é obrigatório.`;
    } else if (form.tipoDocumento === "cpf") {
      if (!validarCPF(form.documento)) e.documento = "CPF inválido. Verifique os dígitos.";
    } else {
      if (!validarCNPJ(form.documento)) e.documento = "CNPJ inválido. Verifique os dígitos.";
    }

    if (!form.email.trim()) e.email = "E-mail é obrigatório.";
    else if (!validarEmail(form.email)) e.email = "E-mail inválido.";

    if (!form.telefone.trim()) e.telefone = "Telefone é obrigatório.";
    else if (!validarTelefone(form.telefone)) e.telefone = "Telefone inválido. Use o formato (XX) XXXXX-XXXX.";

    if (form.telefone2.trim() && !validarTelefone(form.telefone2)) {
      e.telefone2 = "Telefone secundário inválido.";
    }

    if (!form.cep.trim()) e.cep = "CEP é obrigatório.";
    else if (soNumeros(form.cep).length !== 8) e.cep = "CEP precisa ter 8 dígitos.";

    if (!form.endereco.trim()) e.endereco = "Endereço é obrigatório.";
    if (!form.numero.trim())   e.numero   = "Número é obrigatório (use 'S/N' se não houver).";
    if (!form.bairro.trim())   e.bairro   = "Bairro é obrigatório.";
    if (!form.cidade.trim())   e.cidade   = "Cidade é obrigatória.";
    if (!form.estado.trim())   e.estado   = "Estado é obrigatório.";

    if (form.tipoMoradia === "apartamento") {
      if (!form.bloco.trim()) e.bloco = "Bloco é obrigatório para apartamento.";
      if (!form.andar.trim()) e.andar = "Andar é obrigatório para apartamento.";
    }

    setErros(e);
    return Object.keys(e).length === 0;
  };

  // Busca endereço pelo CEP usando ViaCEP
  const buscarCEP = async (cep) => {
    const n = soNumeros(cep);
    if (n.length !== 8) return;
    setBuscandoCEP(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${n}/json/`);
      const data = await res.json();
      if (data.erro) {
        setErros((e) => ({ ...e, cep: "CEP não encontrado." }));
        return;
      }
      setForm((f) => ({
        ...f,
        endereco: data.logradouro || f.endereco,
        bairro:   data.bairro     || f.bairro,
        cidade:   data.localidade || f.cidade,
        estado:   data.uf         || f.estado,
      }));
      setErros((e) => ({ ...e, cep: undefined, endereco: undefined, bairro: undefined, cidade: undefined, estado: undefined }));
    } catch (err) {
      console.error("[ClienteForm] Erro ao buscar CEP:", err);
      setErros((e) => ({ ...e, cep: "Não foi possível buscar o CEP. Preencha manualmente." }));
    } finally {
      setBuscandoCEP(false);
    }
  };

  const handleCEPChange = (valor) => {
    const formatado = formatarCEP(valor);
    setCampo("cep", formatado);
    if (soNumeros(formatado).length === 8) {
      buscarCEP(formatado);
    }
  };

  // ===== Verificação no mapa (OpenStreetMap / Nominatim) =====
  // Só verifica DEPOIS que o número do endereço foi preenchido (o número
  // é importante pra precisão da busca — sem ele o OSM costuma errar).
  // Usa debounce de 1.5 segundos pra esperar o usuário parar de digitar.
  useEffect(() => {
    // Só verifica se TODOS os campos essenciais estiverem preenchidos
    // (incluindo o NÚMERO, que é o que faltava antes)
    if (
      !form.endereco.trim() ||
      !form.numero.trim() ||
      !form.cidade.trim() ||
      !form.estado.trim()
    ) {
      setStatusMapa("ocioso");
      setEnderecoEncontrado(null);
      return;
    }

    // Debounce de 1.5s — espera o usuário parar de digitar
    const timer = setTimeout(async () => {
      setStatusMapa("verificando");
      try {
        // Monta a query com os dados do endereço
        // Inclui o número se for um número real (não 'S/N')
        const numeroPraQuery = form.numero && !/^s\/?n$/i.test(form.numero.trim())
          ? form.numero.trim()
          : null;
        const enderecoCompleto = numeroPraQuery
          ? `${form.endereco}, ${numeroPraQuery}`
          : form.endereco;

        const query = [
          enderecoCompleto,
          form.bairro,
          form.cidade,
          form.estado,
          "Brasil",
        ]
          .filter((s) => s && s.trim())
          .join(", ");

        // Chama a API do Nominatim (OpenStreetMap)
        // Nota: Nominatim pede um User-Agent identificável e limita a 1 req/segundo.
        // O debounce acima já garante o limite.
        const fazBusca = async (q) => {
          const u = `https://nominatim.openstreetmap.org/search?` +
            `format=json&limit=1&countrycodes=br&q=${encodeURIComponent(q)}`;
          const r = await fetch(u, { headers: { "Accept": "application/json" } });
          if (!r.ok) throw new Error("Falha na consulta ao mapa");
          return await r.json();
        };

        // 1ª tentativa: com endereço completo (rua + número)
        let data = await fazBusca(query);

        // 2ª tentativa (fallback): se não achou e tinha número, tenta sem o número
        // Muitas ruas no OSM não têm todos os números mapeados — o fallback ajuda.
        if ((!data || data.length === 0) && numeroPraQuery) {
          const querySemNumero = [
            form.endereco,
            form.bairro,
            form.cidade,
            form.estado,
            "Brasil",
          ].filter((s) => s && s.trim()).join(", ");
          data = await fazBusca(querySemNumero);
        }

        if (data && data.length > 0) {
          setStatusMapa("encontrado");
          setEnderecoEncontrado(data[0].display_name);
        } else {
          setStatusMapa("nao_encontrado");
          setEnderecoEncontrado(null);
        }
      } catch (err) {
        console.error("[ClienteForm] Erro ao verificar endereço no mapa:", err);
        // Em caso de erro de rede, não bloqueia — só marca como erro
        setStatusMapa("erro");
        setEnderecoEncontrado(null);
      }
    }, 1500); // 1.5 segundos de debounce

    return () => clearTimeout(timer);
  }, [form.endereco, form.numero, form.bairro, form.cidade, form.estado]);

  // ===== Detecção de cliente já cadastrado =====
  // Quando o vendedor digitar um CPF/CNPJ válido em UM NOVO cadastro,
  // verifica se já existe no banco. Se sim, dispara o callback pro
  // PedidoVendaModule mostrar o pop-up.
  // Não faz isso quando estiver EDITANDO um cliente existente.
  useEffect(() => {
    // Só verifica em CADASTROS NOVOS (não em edição)
    if (clienteInicial?.id) return;
    if (!onClienteJaExiste) return;

    const docNumeros = soNumeros(form.documento);
    const tipoDoc = form.tipoDocumento;

    // Só verifica se o documento estiver completo e válido
    if (tipoDoc === "cpf" && (docNumeros.length !== 11 || !validarCPF(docNumeros))) return;
    if (tipoDoc === "cnpj" && (docNumeros.length !== 14 || !validarCNPJ(docNumeros))) return;

    // Debounce de 500ms pra não buscar enquanto digita
    const timer = setTimeout(async () => {
      try {
        const { data, error } = await supabase
          .from("clientes")
          .select("*")
          .eq("documento", docNumeros)
          .maybeSingle();

        if (error) {
          console.error("[ClienteForm] Erro ao verificar duplicado:", error);
          return;
        }
        if (data) {
          // Achou! Avisa o módulo pai
          onClienteJaExiste(data);
        }
      } catch (err) {
        console.error("[ClienteForm] Erro:", err);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [form.documento, form.tipoDocumento, clienteInicial, onClienteJaExiste]);

  const handleSalvar = async () => {
    setErroGeral(null);
    if (!validar()) {
      setErroGeral("Verifique os campos marcados em vermelho.");
      return;
    }
    setSalvando(true);
    try {
      await onSalvar(form);
    } catch (err) {
      console.error("[ClienteForm] Erro ao salvar:", err);
      if (err.code === "23505" || err.message?.includes("duplicate")) {
        setErroGeral(`Já existe um cliente cadastrado com esse ${form.tipoDocumento.toUpperCase()}.`);
      } else if (err.message?.includes("policy")) {
        setErroGeral("Você não tem permissão para salvar este cadastro.");
      } else {
        setErroGeral("Erro ao salvar: " + err.message);
      }
    } finally {
      setSalvando(false);
    }
  };

  // Helper de classe pra input com/sem erro
  const inputClass = (campo) =>
    `w-full px-3 py-2 text-sm border rounded-md bg-white focus:outline-none focus:ring-2 transition-colors ${
      erros[campo]
        ? "border-red-400 focus:ring-red-200 focus:border-red-500"
        : "border-stone-300 focus:ring-red-700/30 focus:border-red-700"
    }`;

  const showErro = (campo) =>
    erros[campo] ? (
      <p className="text-xs text-red-700 mt-1">{erros[campo]}</p>
    ) : null;

  return (
    <div className="bg-white border border-stone-200 rounded-lg p-6 space-y-6">
      {/* Seção 1: Dados pessoais */}
      <div>
        <h3 className="font-serif text-lg font-semibold text-stone-900 mb-4 pb-2 border-b border-stone-100">
          Dados {form.tipoDocumento === "cnpj" ? "da empresa" : "pessoais"}
        </h3>
        <div className="grid md:grid-cols-2 gap-4">
          {/* PRIMEIRO: Tipo de documento (CPF / CNPJ) */}
          <div className="md:col-span-2">
            <label className="text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1.5 block">
              Tipo de cadastro *
            </label>
            <div className="flex gap-2 max-w-md">
              <button
                type="button"
                onClick={() => {
                  setCampo("tipoDocumento", "cpf");
                  setCampo("documento", "");
                  // Limpa inscrição estadual se trocar pra CPF
                  setCampo("inscricaoEstadual", "");
                }}
                className={`flex-1 px-3 py-2.5 text-sm font-medium rounded-md border transition-colors ${
                  form.tipoDocumento === "cpf"
                    ? "bg-red-700 text-white border-red-700"
                    : "bg-white text-stone-700 border-stone-300 hover:bg-stone-50"
                }`}
              >
                Pessoa Física (CPF)
              </button>
              <button
                type="button"
                onClick={() => {
                  setCampo("tipoDocumento", "cnpj");
                  setCampo("documento", "");
                }}
                className={`flex-1 px-3 py-2.5 text-sm font-medium rounded-md border transition-colors ${
                  form.tipoDocumento === "cnpj"
                    ? "bg-red-700 text-white border-red-700"
                    : "bg-white text-stone-700 border-stone-300 hover:bg-stone-50"
                }`}
              >
                Pessoa Jurídica (CNPJ)
              </button>
            </div>
          </div>

          {/* Número do documento */}
          <div className="md:col-span-2">
            <label className="text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1.5 block">
              {form.tipoDocumento === "cpf" ? "CPF" : "CNPJ"} *
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={form.documento}
              onChange={(e) => {
                const formatado = form.tipoDocumento === "cpf"
                  ? formatarCPF(e.target.value)
                  : formatarCNPJ(e.target.value);
                setCampo("documento", formatado);
              }}
              placeholder={form.tipoDocumento === "cpf" ? "000.000.000-00" : "00.000.000/0000-00"}
              className={inputClass("documento")}
              autoFocus
            />
            {showErro("documento")}
          </div>

          {/* Nome do cliente OU Razão Social — depende do tipo */}
          <div className="md:col-span-2">
            <label className="text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1.5 block">
              {form.tipoDocumento === "cpf" ? "Nome completo *" : "Razão Social *"}
            </label>
            <input
              type="text"
              value={form.nome}
              onChange={(e) => setCampo("nome", e.target.value)}
              placeholder={form.tipoDocumento === "cpf" ? "Ex: Maria Silva" : "Ex: Sofá Show Comércio Ltda"}
              className={inputClass("nome")}
            />
            {showErro("nome")}
          </div>

          {/* Inscrição Estadual — só pra CNPJ, opcional */}
          {form.tipoDocumento === "cnpj" && (
            <div className="md:col-span-2">
              <label className="text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1.5 block">
                Inscrição Estadual (opcional)
              </label>
              <input
                type="text"
                value={form.inscricaoEstadual || ""}
                onChange={(e) => setCampo("inscricaoEstadual", e.target.value)}
                placeholder="Ex: 123.456.789.012 ou ISENTO"
                className={inputClass("inscricaoEstadual")}
              />
              <p className="text-xs text-stone-500 mt-1">
                Se a empresa for isenta, pode digitar "ISENTO".
              </p>
            </div>
          )}

          {/* E-mail */}
          <div className="md:col-span-2">
            <label className="text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1.5 block">
              E-mail *
            </label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setCampo("email", e.target.value)}
              placeholder={form.tipoDocumento === "cnpj" ? "contato@empresa.com" : "cliente@exemplo.com"}
              className={inputClass("email")}
            />
            {showErro("email")}
          </div>

          {/* Telefone principal */}
          <div>
            <label className="text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1.5 block">
              Telefone principal *
            </label>
            <input
              type="text"
              inputMode="tel"
              value={form.telefone}
              onChange={(e) => setCampo("telefone", formatarTelefone(e.target.value))}
              placeholder="(11) 91234-5678"
              className={inputClass("telefone")}
            />
            {showErro("telefone")}
          </div>

          {/* Telefone secundário */}
          <div>
            <label className="text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1.5 block">
              Telefone secundário (opcional)
            </label>
            <input
              type="text"
              inputMode="tel"
              value={form.telefone2}
              onChange={(e) => setCampo("telefone2", formatarTelefone(e.target.value))}
              placeholder="(11) 91234-5678"
              className={inputClass("telefone2")}
            />
            {showErro("telefone2")}
          </div>
        </div>
      </div>

      {/* Seção 2: Endereço */}
      <div>
        <h3 className="font-serif text-lg font-semibold text-stone-900 mb-4 pb-2 border-b border-stone-100">
          Endereço
        </h3>
        <div className="grid md:grid-cols-3 gap-4">
          {/* CEP */}
          <div>
            <label className="text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1.5 block">
              CEP *
              {buscandoCEP && (
                <span className="ml-2 inline-flex items-center gap-1 text-stone-500 normal-case font-normal">
                  <Loader2 className="w-3 h-3 animate-spin" /> buscando...
                </span>
              )}
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={form.cep}
              onChange={(e) => handleCEPChange(e.target.value)}
              placeholder="00000-000"
              className={inputClass("cep")}
            />
            {showErro("cep")}
          </div>

          {/* Endereço (rua) — ocupa 2 colunas */}
          <div className="md:col-span-2">
            <label className="text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1.5 block">
              Endereço (rua/avenida) *
            </label>
            <input
              type="text"
              value={form.endereco}
              onChange={(e) => setCampo("endereco", e.target.value)}
              placeholder="Ex: Rua das Flores"
              className={inputClass("endereco")}
            />
            {showErro("endereco")}
          </div>

          {/* Número */}
          <div>
            <label className="text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1.5 block">
              Número *
            </label>
            <input
              type="text"
              value={form.numero}
              onChange={(e) => setCampo("numero", e.target.value)}
              placeholder="Ex: 123 ou S/N"
              className={inputClass("numero")}
            />
            {showErro("numero")}
          </div>

          {/* Bairro */}
          <div>
            <label className="text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1.5 block">
              Bairro *
            </label>
            <input
              type="text"
              value={form.bairro}
              onChange={(e) => setCampo("bairro", e.target.value)}
              placeholder="Ex: Centro"
              className={inputClass("bairro")}
            />
            {showErro("bairro")}
          </div>

          {/* Cidade */}
          <div>
            <label className="text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1.5 block">
              Cidade *
            </label>
            <input
              type="text"
              value={form.cidade}
              onChange={(e) => setCampo("cidade", e.target.value)}
              placeholder="Ex: São Paulo"
              className={inputClass("cidade")}
            />
            {showErro("cidade")}
          </div>

          {/* Estado */}
          <div>
            <label className="text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1.5 block">
              Estado *
            </label>
            <input
              type="text"
              value={form.estado}
              onChange={(e) => setCampo("estado", e.target.value.toUpperCase().slice(0, 2))}
              placeholder="SP"
              maxLength={2}
              className={inputClass("estado")}
            />
            {showErro("estado")}
          </div>
        </div>

        {/* Card de status da verificação no mapa */}
        {statusMapa === "verificando" && (
          <div className="mt-3 bg-stone-50 border border-stone-200 rounded-md p-3 flex items-center gap-2 text-xs text-stone-600">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Verificando endereço no mapa...
          </div>
        )}

        {statusMapa === "encontrado" && enderecoEncontrado && (
          <div className="mt-3 bg-emerald-50 border border-emerald-200 rounded-md p-3 flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 mt-0.5 flex-shrink-0" />
            <div className="text-xs text-emerald-900">
              <p className="font-semibold mb-0.5">Endereço encontrado no mapa</p>
              <p className="text-emerald-800">{enderecoEncontrado}</p>
            </div>
          </div>
        )}

        {statusMapa === "nao_encontrado" && (
          <div className="mt-3 bg-amber-50 border border-amber-300 rounded-md p-3 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-700 mt-0.5 flex-shrink-0" />
            <div className="text-xs text-amber-900">
              <p className="font-semibold mb-0.5">⚠ Endereço não localizado no mapa</p>
              <p className="text-amber-800">
                Não conseguimos encontrar este endereço no mapa. Confirme os dados com o cliente antes de finalizar.
                O cadastro pode ser salvo mesmo assim.
              </p>
            </div>
          </div>
        )}

        {statusMapa === "erro" && (
          <div className="mt-3 bg-stone-50 border border-stone-200 rounded-md p-3 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-stone-600 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-stone-700">
              Não foi possível verificar o endereço no mapa agora (erro de conexão). O cadastro pode ser salvo mesmo assim.
            </p>
          </div>
        )}
      </div>

      {/* Seção 3: Tipo de moradia */}
      <div>
        <h3 className="font-serif text-lg font-semibold text-stone-900 mb-4 pb-2 border-b border-stone-100">
          Tipo de moradia
        </h3>
        <div className="space-y-4">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setCampo("tipoMoradia", "casa")}
              className={`flex-1 max-w-xs px-3 py-2 text-sm font-medium rounded-md border transition-colors ${
                form.tipoMoradia === "casa"
                  ? "bg-red-700 text-white border-red-700"
                  : "bg-white text-stone-700 border-stone-300 hover:bg-stone-50"
              }`}
            >
              🏠 Casa
            </button>
            <button
              type="button"
              onClick={() => setCampo("tipoMoradia", "apartamento")}
              className={`flex-1 max-w-xs px-3 py-2 text-sm font-medium rounded-md border transition-colors ${
                form.tipoMoradia === "apartamento"
                  ? "bg-red-700 text-white border-red-700"
                  : "bg-white text-stone-700 border-stone-300 hover:bg-stone-50"
              }`}
            >
              🏢 Apartamento
            </button>
          </div>

          {form.tipoMoradia === "apartamento" && (
            <div className="grid md:grid-cols-2 gap-4 bg-red-50/30 border border-red-100 rounded-md p-4">
              <div>
                <label className="text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1.5 block">
                  Bloco *
                </label>
                <input
                  type="text"
                  value={form.bloco}
                  onChange={(e) => setCampo("bloco", e.target.value)}
                  placeholder="Ex: A"
                  className={inputClass("bloco")}
                />
                {showErro("bloco")}
              </div>
              <div>
                <label className="text-xs font-semibold text-stone-700 uppercase tracking-wider mb-1.5 block">
                  Andar *
                </label>
                <input
                  type="text"
                  value={form.andar}
                  onChange={(e) => setCampo("andar", e.target.value)}
                  placeholder="Ex: 5"
                  className={inputClass("andar")}
                />
                {showErro("andar")}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Erro geral */}
      {erroGeral && (
        <div className="bg-red-50 border border-red-200 rounded-md p-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-700 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-900">{erroGeral}</p>
        </div>
      )}

      {/* Botões */}
      <div className="flex gap-2 pt-4 border-t border-stone-100">
        <button
          onClick={handleSalvar}
          disabled={salvando}
          className="flex items-center gap-1.5 px-5 py-2 text-sm bg-emerald-700 text-white font-medium rounded-md hover:bg-emerald-800 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {form.id ? "Salvar alterações" : "Cadastrar cliente"}
        </button>
        <button
          onClick={onCancelar}
          disabled={salvando}
          className="px-4 py-2 text-sm text-stone-600 hover:text-stone-900"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

// ============================================================
// PESQUISA DE CLIENTES — lista com busca
// ============================================================

function ClientePesquisa({ clientes, loaded, onVoltar, onEditar, onRemover, onFazerPedido }) {
  const [busca, setBusca] = useState("");

  const norm = (s) =>
    String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

  const filtrados = useMemo(() => {
    const q = norm(busca.trim());
    if (!q) return clientes;
    return clientes.filter((c) => {
      return (
        norm(c.nome).includes(q) ||
        norm(c.documento).includes(q) ||
        norm(c.email).includes(q) ||
        norm(c.telefone).includes(q) ||
        norm(c.cidade).includes(q) ||
        // Busca também por número do cliente (ex: digitar "5" acha o cliente nº 5)
        String(c.numero_cliente || "").includes(q)
      );
    });
  }, [clientes, busca]);

  return (
    <div>
      {/* Botão voltar e busca */}
      <div className="mb-4 flex items-center gap-3">
        <button
          onClick={onVoltar}
          className="flex items-center gap-1 px-3 py-2 text-sm text-stone-700 hover:bg-stone-100 rounded-md"
        >
          <ChevronRight className="w-4 h-4 rotate-180" />
          Voltar
        </button>
        <div className="flex-1 relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            autoFocus
            placeholder="Buscar por número, nome, CPF/CNPJ, email, telefone ou cidade..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-700/30 focus:border-red-700"
          />
        </div>
      </div>

      {!loaded ? (
        <div className="flex items-center gap-2 text-stone-500 justify-center py-20">
          <Loader2 className="w-5 h-5 animate-spin" />
          Carregando clientes...
        </div>
      ) : filtrados.length === 0 ? (
        <div className="text-center py-12 bg-stone-50 rounded-lg text-stone-500 text-sm">
          {clientes.length === 0
            ? "Nenhum cliente cadastrado ainda."
            : `Nenhum cliente encontrado para "${busca}".`}
        </div>
      ) : (
        <div className="space-y-2">
          {filtrados.map((c) => (
            <ClienteCard
              key={c.id}
              cliente={c}
              onEditar={() => onEditar(c)}
              onRemover={() => onRemover(c)}
              onFazerPedido={() => onFazerPedido(c)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ClienteCard({ cliente, onEditar, onRemover, onFazerPedido }) {
  const docFormatado = cliente.tipo_documento === "cnpj"
    ? formatarCNPJ(cliente.documento)
    : formatarCPF(cliente.documento);
  const telFormatado = formatarTelefone(cliente.telefone);

  return (
    <div className="border border-stone-200 bg-white rounded-lg p-4">
      <div className="flex items-start gap-3 mb-2">
        {/* Número do cliente — pequeno, lateral esquerda */}
        {cliente.numero_cliente && (
          <div className="flex-shrink-0 text-[10px] uppercase tracking-wider text-stone-400 font-semibold pt-0.5">
            <div>Nº</div>
            <div className="text-stone-700 text-sm font-bold leading-tight">
              {cliente.numero_cliente}
            </div>
          </div>
        )}

        <div className="flex-1 min-w-0">
          <h3 className="font-serif text-base font-semibold text-stone-900">
            {cliente.nome}
          </h3>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-600 mt-1">
            <span>{cliente.tipo_documento.toUpperCase()}: <strong>{docFormatado}</strong></span>
            <span>📧 {cliente.email}</span>
            <span>📞 {telFormatado}</span>
            <span>📍 {cliente.cidade}/{cliente.estado}</span>
          </div>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button
            onClick={onFazerPedido}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-red-700 text-white rounded-md hover:bg-red-800"
            title="Fazer pedido para este cliente"
          >
            <Plus className="w-3 h-3" />
            Pedido
          </button>
          <button
            onClick={onEditar}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-red-800 border border-red-200 rounded-md hover:bg-red-50"
          >
            <Pencil className="w-3 h-3" />
            Editar
          </button>
          <button
            onClick={onRemover}
            className="p-1.5 text-stone-500 hover:bg-red-50 hover:text-red-700 rounded-md"
            title="Remover cliente"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function PlaceholderModule({ title, description }) {
  return (
    <div className="max-w-3xl mx-auto text-center py-20">
      <div className="inline-block p-4 bg-red-50 rounded-full mb-4">
        <Settings className="w-8 h-8 text-red-700" />
      </div>
      <h1 className="font-serif text-3xl font-bold text-stone-900 mb-2">{title}</h1>
      <p className="text-stone-600">{description}</p>
      <p className="text-xs uppercase tracking-widest text-red-700 font-semibold mt-6">
        Em breve
      </p>
    </div>
  );
}

// ============================================================
// APP SHELL
// ============================================================

export default function App() {
  // Autenticação
  const { user, loading: authLoading, logout } = useAuth();

  // Sanfona: qual aba pai está aberta (null = todas fechadas).
  // Só uma pode ficar aberta por vez. Declarado aqui no topo pra ficar
  // disponível pro setActiveModule abaixo.
  const [abaAberta, setAbaAberta] = useState(null);

  // resetKey: incrementa toda vez que o usuário clica num submódulo no menu.
  // É passado como `key` pro componente do módulo — quando muda, o React
  // desmonta e remonta o componente, resetando o estado interno (volta pra
  // tela inicial do módulo).
  const [resetKey, setResetKey] = useState(0);

  // Hooks restantes (sempre chamados, em qualquer ordem — regras de hooks do React)
  const { module: activeModule, bancoId: bancoSelecionadoId, navigate } = useHashRoute();
  const setActiveModule = (m) => {
    navigate(m, null);
    // Sempre incrementa o resetKey: assim, mesmo se o usuário clicar no mesmo
    // módulo onde já está, o componente é remontado e volta pra tela inicial.
    setResetKey((k) => k + 1);
    // Quando o módulo é trocado (ex: via busca global ou logo), abre
    // automaticamente a aba pai dele pra o usuário ver onde está.
    const PARENT_DE = {
      conciliacao:   "administrativo",
      cores:         "administrativo",
      financeiro:    "financeiro",
      taxas:         "financeiro",
      pedido_venda:  "vendas",
    };
    const parent = PARENT_DE[m];
    if (parent) {
      setAbaAberta(parent);
    }
  };
  // ETAPA B: agora também recebemos o `error` de cada hook pra mostrar na UI
  // E `reload` pra atualizar quando o usuário entra na tela
  const { table: colorTable, save: saveColorTable, loaded: colorsLoaded, error: errorCores, reload: reloadCores } = useColorTable();
  const { taxas: taxasBlu, save: saveTaxasBlu, loaded: taxasBluLoaded, error: errorTaxasBlu, reload: reloadTaxasBlu } = useTaxasBlu();
  const { taxas: taxasPV, save: saveTaxasPV, loaded: taxasPVLoaded, error: errorTaxasPV, reload: reloadTaxasPV } = useTaxasPagueVeloz();
  // ETAPA C: contexto do usuário (grupo + lojas + permissões)
  const userCtx = useUserContext(user);

  // ETAPA C+: modal de trocar senha
  const [mostrarTrocaSenha, setMostrarTrocaSenha] = useState(false);

  // Recarrega automaticamente os dados do Supabase quando o usuário entra
  // numa tela. Assim, se outra loja editou enquanto a tela estava aberta
  // em outro lugar, ao voltar pra essa tela, a versão mais nova aparece.
  useEffect(() => {
    if (!user) return; // só recarrega se estiver logado
    if (activeModule === "cores") {
      reloadCores();
    } else if (activeModule === "taxas") {
      reloadTaxasBlu();
      reloadTaxasPV();
    }
  }, [activeModule, user, reloadCores, reloadTaxasBlu, reloadTaxasPV]);

  // === PROTEÇÃO DE LOGIN ===
  // Enquanto verifica se está logado, mostra um carregamento simples
  if (authLoading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="flex items-center gap-3 text-stone-600">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Carregando...</span>
        </div>
      </div>
    );
  }
  // Se não está logado, mostra a tela de login
  if (!user) {
    return <LoginScreen />;
  }
  // ETAPA C: enquanto carrega o contexto do usuário (grupo, permissões, lojas)
  if (userCtx.loading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="flex items-center gap-3 text-stone-600">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Carregando suas permissões...</span>
        </div>
      </div>
    );
  }
  // Se está logado, segue pro app normal abaixo

  // ETAPA C: Lista de módulos respeitando permissões + lojas
  // Os 4 módulos administrativos só aparecem se:
  //   • o usuário está no Escritório (ou é admin) E
  //   • o grupo dele dá permissão (visualizar ou editar) no módulo
  const podeVerAdmin = userCtx.estaNoEscritorio;
  const modules = [
    {
      id: "conciliacao",
      label: "Conciliação dos Pedidos",
      labelLong: "Conciliação dos Pedidos com os Negativos do Sistema",
      icon: GitCompare,
      available: true,
      visible: podeVerAdmin && podeVerModulo(userCtx.permissoes, "conciliacao"),
      parent: "administrativo",
    },
    {
      id: "cores",
      label: "Tabela de Cores",
      icon: Palette,
      available: true,
      visible: podeVerAdmin && podeVerModulo(userCtx.permissoes, "cores"),
      parent: "administrativo",
    },
    {
      id: "financeiro",
      label: "Conciliação Financeira",
      icon: CircleDollarSign,
      available: true,
      visible: podeVerAdmin && podeVerModulo(userCtx.permissoes, "financeiro"),
      parent: "financeiro",
    },
    {
      id: "taxas",
      label: "Tabelas de Taxas de Cartões",
      icon: CreditCard,
      available: true,
      visible: podeVerAdmin && podeVerModulo(userCtx.permissoes, "taxas"),
      parent: "financeiro",
    },
    {
      id: "pedido_venda",
      label: "Cadastro de Clientes",
      icon: UserPlus,
      available: true,
      visible: true, // todos os usuários logados
      parent: "vendas",
    },
    {
      id: "permissoes",
      label: userCtx.isRH && !userCtx.isAdmin ? "Cadastro de Funcionários" : "Gerenciar Permissões",
      icon: Users,
      available: true,
      visible: userCtx.isAdmin || userCtx.isRH, // admin ou RH
      adminOnly: userCtx.isAdmin, // só mostra badge "Admin" se for admin
      rhOnly: userCtx.isRH && !userCtx.isAdmin, // badge "RH" se for só RH
      parent: null, // fica solto, sem aba pai
    },
    {
      id: "estoque",
      label: "Gestão de Estoque",
      icon: Package,
      available: false,
      visible: false, // futuro
      parent: null,
    },
    {
      id: "relatorios",
      label: "Relatórios",
      icon: BarChart3,
      available: false,
      visible: false, // futuro
      parent: null,
    },
    {
      id: "config",
      label: "Configurações",
      icon: Settings,
      available: false,
      visible: false, // futuro
      parent: null,
    },
  ];

  // Filtra só os módulos visíveis pra esse usuário
  const modulesVisiveis = modules.filter((m) => m.visible);

  // Estrutura agrupada para o menu lateral.
  // - Cada aba pai (Administrativo, Financeiro) só aparece se TIVER pelo menos
  //   um filho visível pra esse usuário.
  // - Módulos sem parent (Permissões) ficam soltos no fim.
  const ABAS_PAI = [
    { id: "administrativo", label: "Administrativo", icon: ClipboardList },
    { id: "financeiro",     label: "Financeiro",     icon: Wallet },
    { id: "vendas",         label: "Vendas",         icon: ShoppingCart },
  ];
  const menuAgrupado = [];
  for (const aba of ABAS_PAI) {
    const filhos = modulesVisiveis.filter((m) => m.parent === aba.id);
    if (filhos.length > 0) {
      menuAgrupado.push({ tipo: "aba", aba, filhos });
    }
  }
  const modulosSoltos = modulesVisiveis.filter((m) => !m.parent);
  for (const m of modulosSoltos) {
    menuAgrupado.push({ tipo: "modulo", modulo: m });
  }

  return (
    <div className="min-h-screen bg-stone-50" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700;9..144,800&family=Inter:wght@400;500;600;700&display=swap');
        .font-serif { font-family: 'Fraunces', Georgia, serif; }
      `}</style>

      {/* Top Bar */}
      <header
        className="text-white border-b-4 border-rose-500"
        style={{ background: "linear-gradient(90deg, #7f1d1d 0%, #b91c1c 100%)" }}
      >
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center gap-4">
          <button
            onClick={() => {
              navigate("home", null);
              setAbaAberta(null); // fecha qualquer aba aberta também
            }}
            title="Voltar para a tela inicial"
            className="flex items-center gap-3 rounded-md p-1 -m-1 hover:bg-white/10 active:bg-white/20 transition-colors cursor-pointer text-left flex-shrink-0"
          >
            <div className="w-10 h-10 rounded-md bg-white/15 border border-white/25 flex items-center justify-center">
              <Armchair className="w-5 h-5 text-white" />
            </div>
            <div className="hidden sm:block">
              <h1 className="font-serif text-xl font-bold tracking-tight leading-none">
                Sofá Show
              </h1>
              <p className="text-[10px] uppercase tracking-[0.2em] text-rose-100/90 mt-0.5">
                App exclusivo da empresa
              </p>
            </div>
          </button>

          {/* Barra de busca global */}
          <div className="flex-1 flex justify-center">
            <GlobalSearchBar
              userCtx={userCtx}
              onNavegar={(rota) => setActiveModule(rota)}
              colorTable={colorTable}
              taxasBlu={taxasBlu}
              taxasPV={taxasPV}
            />
          </div>

          <div className="text-xs text-white/70 hidden md:block flex-shrink-0">
            21/04/2026
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <aside className="w-64 bg-white border-r border-stone-200 min-h-[calc(100vh-73px)] py-6 px-3 hidden md:flex md:flex-col">
          <div className="flex-1">
            <p className="text-[10px] uppercase tracking-[0.2em] text-stone-500 font-semibold px-3 mb-3">
              Módulos
            </p>
            <nav className="space-y-1">
              {menuAgrupado.map((item, idx) => {
                if (item.tipo === "aba") {
                  // Aba pai: header clicável (sanfona) + filhos só aparecem se aberta
                  const AbaIcon = item.aba.icon;
                  const aberta = abaAberta === item.aba.id;
                  // Verifica se o módulo ativo é filho dessa aba
                  const moduloAtivoEhFilho = item.filhos.some((m) => m.id === activeModule);
                  return (
                    <div key={item.aba.id} className={idx > 0 ? "mt-3" : ""}>
                      {/* Cabeçalho da aba pai (clicável) */}
                      <button
                        onClick={() => {
                          if (aberta) {
                            // Aba já está aberta: fecha
                            setAbaAberta(null);
                            // Se o usuário está num submódulo dessa aba, volta pra tela inicial
                            // (limpa o activeModule pra mostrar a tela de boas-vindas)
                            if (moduloAtivoEhFilho) {
                              navigate("home", null);
                            }
                          } else {
                            // Aba fechada: abre
                            setAbaAberta(item.aba.id);
                          }
                        }}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm text-left transition-colors ${
                          aberta
                            ? "bg-red-50 text-red-800 font-semibold"
                            : "text-stone-700 hover:bg-stone-100 font-medium"
                        }`}
                      >
                        <AbaIcon className={`w-4 h-4 flex-shrink-0 ${aberta ? "text-red-700" : "text-stone-500"}`} />
                        <span className="flex-1">{item.aba.label}</span>
                        <ChevronDown
                          className={`w-4 h-4 flex-shrink-0 transition-transform ${
                            aberta ? "rotate-180 text-red-700" : "text-stone-400"
                          }`}
                        />
                      </button>

                      {/* Submódulos identados — só aparecem se aba aberta */}
                      {aberta && (
                        <div className="space-y-1 mt-1">
                          {item.filhos.map((m) => (
                            <button
                              key={m.id}
                              onClick={() => m.available && setActiveModule(m.id)}
                              disabled={!m.available}
                              className={`w-full flex items-center gap-3 pl-9 pr-3 py-2 rounded-md text-sm text-left transition-colors ${
                                activeModule === m.id
                                  ? "bg-red-50 text-red-800 font-semibold border-l-4 border-red-700 rounded-l-none pl-8"
                                  : m.available
                                  ? "text-stone-700 hover:bg-stone-100"
                                  : "text-stone-400 cursor-not-allowed"
                              }`}
                            >
                              <m.icon className="w-4 h-4 flex-shrink-0" />
                              <span className="flex-1">{m.label}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                } else {
                  // Módulo solto (sem aba pai)
                  const m = item.modulo;
                  return (
                    <div key={m.id} className={idx > 0 ? "mt-3 pt-3 border-t border-stone-200" : ""}>
                      <button
                        onClick={() => m.available && setActiveModule(m.id)}
                        disabled={!m.available}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm text-left transition-colors ${
                          activeModule === m.id
                            ? "bg-red-50 text-red-800 font-semibold border-l-4 border-red-700 rounded-l-none pl-2"
                            : m.available
                            ? "text-stone-700 hover:bg-stone-100"
                            : "text-stone-400 cursor-not-allowed"
                        }`}
                      >
                        <m.icon className="w-4 h-4 flex-shrink-0" />
                        <span className="flex-1">{m.label}</span>
                        {m.adminOnly && (
                          <span className="text-[9px] uppercase tracking-wider bg-red-700 text-white px-1.5 py-0.5 rounded">
                            Admin
                          </span>
                        )}
                        {m.rhOnly && (
                          <span className="text-[9px] uppercase tracking-wider bg-amber-600 text-white px-1.5 py-0.5 rounded">
                            RH
                          </span>
                        )}
                        {!m.available && (
                          <span className="text-[9px] uppercase tracking-wider bg-stone-200 text-stone-600 px-1.5 py-0.5 rounded">
                            Em breve
                          </span>
                        )}
                      </button>
                    </div>
                  );
                }
              })}
              {modulesVisiveis.length === 0 && (
                <div className="px-3 py-4 text-xs text-stone-500 italic">
                  Você ainda não tem módulos liberados.<br />
                  Fale com a administradora.
                </div>
              )}
            </nav>
          </div>

          {/* Painel do usuário logado */}
          <div className="border-t border-stone-200 pt-4 mt-4 px-1">
            <div className="px-3 mb-2">
              <p className="text-[10px] uppercase tracking-[0.2em] text-stone-500 font-semibold mb-1">
                Conectada como
              </p>
              <p className="text-xs text-stone-800 font-medium truncate" title={user.email}>
                {user.email}
              </p>
              {userCtx.grupoNome && (
                <p className="text-[10px] text-stone-500 mt-0.5">
                  {userCtx.grupoNome}
                  {userCtx.isAdmin && <span className="ml-1 text-red-700 font-semibold">• Admin</span>}
                  {userCtx.isRH && !userCtx.isAdmin && <span className="ml-1 text-amber-700 font-semibold">• RH</span>}
                </p>
              )}
            </div>
            <button
              onClick={() => setMostrarTrocaSenha(true)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-xs text-stone-600 hover:bg-stone-100 hover:text-stone-900 transition-colors"
              title="Trocar minha senha"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Trocar senha</span>
            </button>
            <button
              onClick={logout}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-xs text-stone-600 hover:bg-stone-100 hover:text-stone-900 transition-colors"
              title="Sair do sistema"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sair</span>
            </button>
          </div>
        </aside>

        {/* Mobile tabs */}
        <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-stone-200 flex z-10">
          {modulesVisiveis
            .filter((m) => m.available)
            .map((m) => (
              <button
                key={m.id}
                onClick={() => setActiveModule(m.id)}
                className={`flex-1 flex flex-col items-center py-2 text-[10px] ${
                  activeModule === m.id
                    ? "text-red-800 font-semibold"
                    : "text-stone-600"
                }`}
              >
                <m.icon className="w-4 h-4 mb-1" />
                {m.label.split(" ")[0]}
              </button>
            ))}
        </div>

        {/* Main */}
        <main className="flex-1 p-6 md:p-10 pb-24 md:pb-10">
          {/* Se o usuário tentou acessar um módulo a que não tem permissão (via URL),
              mostra mensagem ao invés de renderizar o módulo */}
          {activeModule !== "permissoes" &&
            activeModule !== "pedido_venda" &&
            !modulesVisiveis.find((m) => m.id === activeModule) && (
            <div className="max-w-2xl mx-auto text-center py-20">
              <div className="inline-block p-4 bg-red-50 rounded-full mb-4">
                <Armchair className="w-8 h-8 text-red-700" />
              </div>
              <h1 className="font-serif text-3xl font-bold text-stone-900 mb-2">
                Bem-vinda à Sofá Show
              </h1>
              <p className="text-stone-600 mb-1">
                {userCtx.grupoNome
                  ? <>Você faz parte do grupo <strong className="text-red-800">{userCtx.grupoNome}</strong>.</>
                  : <>Você ainda não foi atribuída a nenhum grupo.</>
                }
              </p>
              {userCtx.lojas.length > 0 ? (
                <p className="text-stone-600 mb-4 text-sm">
                  Lojas: <strong>{userCtx.lojas.map((l) => l.nome).join(", ")}</strong>
                </p>
              ) : (
                <p className="text-stone-600 mb-4 text-sm">
                  Você ainda não tem lojas atribuídas.
                </p>
              )}
              {modulesVisiveis.length === 0 && (
                <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-3 mt-4">
                  Você não tem nenhum módulo liberado ainda.<br />
                  Fale com a administradora para liberar acessos.
                </p>
              )}
              {modulesVisiveis.length > 0 && (
                <p className="text-sm text-stone-600 mt-4">
                  Use o menu à esquerda pra acessar os módulos disponíveis.
                </p>
              )}
            </div>
          )}

          {activeModule === "conciliacao" && modulesVisiveis.find((m) => m.id === "conciliacao") && (
            <ConciliacaoModule key={resetKey} colorTable={colorTable} />
          )}
          {activeModule === "cores" && modulesVisiveis.find((m) => m.id === "cores") && colorsLoaded && (
            <ColorTableModule
              key={resetKey}
              table={colorTable}
              onSave={saveColorTable}
              supabaseError={errorCores}
            />
          )}
          {activeModule === "cores" && modulesVisiveis.find((m) => m.id === "cores") && !colorsLoaded && (
            <div className="flex items-center gap-2 text-stone-500 justify-center py-20">
              <Loader2 className="w-5 h-5 animate-spin" />
              Carregando tabela…
            </div>
          )}
          {activeModule === "financeiro" && modulesVisiveis.find((m) => m.id === "financeiro") && (
            <FinanceiroModule
              key={resetKey}
              bancoSelecionadoId={bancoSelecionadoId}
              onSelecionarBanco={(id) => navigate("financeiro", id)}
              onTrocarBanco={() => navigate("financeiro", null)}
            />
          )}
          {activeModule === "taxas" && modulesVisiveis.find((m) => m.id === "taxas") && taxasBluLoaded && taxasPVLoaded && (
            <TaxasModule
              key={resetKey}
              taxasBlu={taxasBlu}
              onSaveTaxasBlu={saveTaxasBlu}
              taxasPV={taxasPV}
              onSaveTaxasPV={saveTaxasPV}
              supabaseErrorBlu={errorTaxasBlu}
              supabaseErrorPV={errorTaxasPV}
            />
          )}
          {activeModule === "taxas" && modulesVisiveis.find((m) => m.id === "taxas") && (!taxasBluLoaded || !taxasPVLoaded) && (
            <div className="flex items-center gap-2 text-stone-500 justify-center py-20">
              <Loader2 className="w-5 h-5 animate-spin" />
              Carregando taxas…
            </div>
          )}
          {activeModule === "permissoes" && (userCtx.isAdmin || userCtx.isRH) && (
            <PermissoesModule key={resetKey} userCtx={userCtx} onUserAlterado={userCtx.reload} />
          )}
          {activeModule === "permissoes" && !userCtx.isAdmin && !userCtx.isRH && (
            <PlaceholderModule
              title="Acesso negado"
              description="Você não tem permissão para acessar esta tela."
            />
          )}
          {activeModule === "pedido_venda" && (
            <PedidoVendaModule key={resetKey} user={user} />
          )}
          {activeModule === "estoque" && (
            <PlaceholderModule
              title="Gestão de Estoque"
              description="Visualize e controle o estoque das lojas."
            />
          )}
          {activeModule === "relatorios" && (
            <PlaceholderModule
              title="Relatórios"
              description="Indicadores gerenciais e análises de vendas."
            />
          )}
          {activeModule === "config" && (
            <PlaceholderModule
              title="Configurações"
              description="Ajustes do sistema e preferências."
            />
          )}
        </main>
      </div>

      {/* Modal de trocar senha */}
      {mostrarTrocaSenha && (
        <TrocaSenhaModal onFechar={() => setMostrarTrocaSenha(false)} />
      )}
    </div>
  );
}
