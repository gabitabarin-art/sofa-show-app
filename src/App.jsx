import React, { useState, useMemo, useEffect, useCallback } from "react";
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
} from "lucide-react";

// ============================================================
// TABELA DE CORES (persistência compartilhada)
// ============================================================

const COLOR_STORAGE_KEY = "sofashow:colorTable";

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
// ============================================================

const TAXAS_BLU_STORAGE_KEY = "sofashow:taxasBlu";

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
// ============================================================

const TAXAS_PV_STORAGE_KEY = "sofashow:taxasPagueVeloz";

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
// HOOK: Tabela de Cores (persistência compartilhada)
// ============================================================

// Detecta se window.storage existe (ambiente Claude). Caso contrário, usa localStorage.
const hasClaudeStorage = typeof window !== "undefined" && window.storage && typeof window.storage.get === "function";

async function storageGet(key) {
  if (hasClaudeStorage) {
    const result = await window.storage.get(key, true);
    return result && result.value ? result.value : null;
  }
  // Fallback: localStorage
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage.getItem(key);
  }
  return null;
}

async function storageSet(key, value) {
  if (hasClaudeStorage) {
    await window.storage.set(key, value, true);
    return;
  }
  // Fallback: localStorage
  if (typeof window !== "undefined" && window.localStorage) {
    window.localStorage.setItem(key, value);
    return;
  }
  throw new Error("Nenhum sistema de armazenamento disponível");
}

function useColorTable() {
  const [table, setTable] = useState([]);
  const [loaded, setLoaded] = useState(false);

  // Carrega ao montar
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const value = await storageGet(COLOR_STORAGE_KEY);
        if (cancelled) return;
        if (value) {
          const parsed = JSON.parse(value);
          setTable(Array.isArray(parsed) ? parsed : DEFAULT_COLOR_TABLE);
        } else {
          setTable(DEFAULT_COLOR_TABLE);
          // Salva os padrões na primeira vez
          try {
            await storageSet(COLOR_STORAGE_KEY, JSON.stringify(DEFAULT_COLOR_TABLE));
          } catch {}
        }
      } catch (e) {
        if (!cancelled) {
          setTable(DEFAULT_COLOR_TABLE);
        }
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async (newTable) => {
    setTable(newTable);
    try {
      await storageSet(COLOR_STORAGE_KEY, JSON.stringify(newTable));
      return true;
    } catch (e) {
      console.error("Erro ao salvar tabela de cores", e);
      return false;
    }
  }, []);

  return { table, save, loaded };
}

// Hook idêntico ao useColorTable, mas pra tabela de taxas de cartões Blu
function useTaxasBlu() {
  const [taxas, setTaxas] = useState(DEFAULT_TAXAS_BLU);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const value = await storageGet(TAXAS_BLU_STORAGE_KEY);
        if (cancelled) return;
        if (value) {
          const parsed = JSON.parse(value);
          // Mescla com os defaults pra garantir que toda chave esteja presente
          // (caso a estrutura cresça depois)
          const merged = { ...DEFAULT_TAXAS_BLU };
          for (const tipo of Object.keys(DEFAULT_TAXAS_BLU)) {
            merged[tipo] = { ...DEFAULT_TAXAS_BLU[tipo], ...(parsed?.[tipo] || {}) };
          }
          setTaxas(merged);
        } else {
          setTaxas(DEFAULT_TAXAS_BLU);
          try {
            await storageSet(TAXAS_BLU_STORAGE_KEY, JSON.stringify(DEFAULT_TAXAS_BLU));
          } catch {}
        }
      } catch (e) {
        if (!cancelled) setTaxas(DEFAULT_TAXAS_BLU);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const save = useCallback(async (novas) => {
    setTaxas(novas);
    try {
      await storageSet(TAXAS_BLU_STORAGE_KEY, JSON.stringify(novas));
      return true;
    } catch (e) {
      console.error("Erro ao salvar tabela de taxas de cartões", e);
      return false;
    }
  }, []);

  return { taxas, save, loaded };
}

// Hook idêntico ao useTaxasBlu, mas pra Pague Veloz (estrutura diferente: 22 linhas, sem grupo)
function useTaxasPagueVeloz() {
  const [taxas, setTaxas] = useState(DEFAULT_TAXAS_PV);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const value = await storageGet(TAXAS_PV_STORAGE_KEY);
        if (cancelled) return;
        if (value) {
          const parsed = JSON.parse(value);
          // Mescla com defaults pra garantir todas as linhas presentes
          const merged = { ...DEFAULT_TAXAS_PV, ...(parsed || {}) };
          setTaxas(merged);
        } else {
          setTaxas(DEFAULT_TAXAS_PV);
          try {
            await storageSet(TAXAS_PV_STORAGE_KEY, JSON.stringify(DEFAULT_TAXAS_PV));
          } catch {}
        }
      } catch (e) {
        if (!cancelled) setTaxas(DEFAULT_TAXAS_PV);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const save = useCallback(async (novas) => {
    setTaxas(novas);
    try {
      await storageSet(TAXAS_PV_STORAGE_KEY, JSON.stringify(novas));
      return true;
    } catch (e) {
      console.error("Erro ao salvar tabela de taxas Pague Veloz", e);
      return false;
    }
  }, []);

  return { taxas, save, loaded };
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
          ? "border-amber-700 bg-amber-50"
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
          <p className="text-xs text-amber-800 mt-2 font-medium">Clique ou arraste aqui</p>
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
    amber: "border-amber-200 bg-amber-50/60",
    stone: "border-stone-200 bg-white",
    purple: "border-purple-200 bg-purple-50/60",
    orange: "border-orange-200 bg-orange-50/60",
  };
  const textColors = {
    red: "text-red-900",
    green: "text-emerald-800",
    amber: "text-amber-900",
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
          <span className="text-xs uppercase tracking-[0.2em] text-amber-800 font-semibold">
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
                    ? "bg-white text-amber-900 shadow-sm"
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
                className="w-full pl-9 pr-3 py-2 text-sm border border-stone-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-amber-700/30 focus:border-amber-700"
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
        <div className="text-center py-16 bg-gradient-to-b from-amber-50/40 to-transparent rounded-lg border border-stone-200">
          <GitCompare className="w-10 h-10 text-amber-800 mx-auto mb-3" />
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
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-800 mt-0.5 flex-shrink-0" />
        <div className="text-xs text-amber-900">
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
          className="border border-amber-200 bg-white rounded-lg overflow-hidden"
        >
          <div className="flex items-start p-4 gap-4">
            <div className="w-10 h-10 rounded-md bg-amber-100 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-5 h-5 text-amber-700" />
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
                  <span className="text-amber-800">
                    Obs: <strong>{p.obs}</strong>
                  </span>
                )}
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-xs text-stone-500 uppercase tracking-wider">Quantidade</p>
              <p className="font-serif text-2xl font-bold text-amber-700">
                {p.quantidade}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ColorTableModule({ table, onSave }) {
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
    setSaveStatus(ok ? "Salvo" : "Erro ao salvar");
    setTimeout(() => setSaveStatus(""), 2000);
  };

  const saveEdit = async () => {
    if (!draft.codigo.trim() || !draft.nome.trim()) return;
    const originalCodigo = table[editing].codigo;
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
    await persistSave(newTable);
    cancelEdit();
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
    await persistSave(newTable);
    setNewEntry({ codigo: "", nome: "" });
    setAdding(false);
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
          <span className="text-xs uppercase tracking-[0.2em] text-amber-800 font-semibold">
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
        <div className="flex items-start gap-2 mt-3 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          <Users className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>
            <strong>Tabela salva no seu navegador.</strong> Cada loja precisa cadastrar suas próprias cores.
            Para compartilhar entre lojas, é necessário um banco de dados (versão futura).
          </span>
        </div>
      </div>

      {/* Barra de ações */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
          <input
            type="text"
            placeholder="Buscar código ou nome…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-stone-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-amber-700/30 focus:border-amber-700"
          />
        </div>
        <button
          onClick={() => {
            setAdding(true);
            setNewEntry({ codigo: "", nome: "" });
          }}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-amber-800 text-white rounded-md hover:bg-amber-900 transition-colors"
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
      </div>

      {/* Linha de adição */}
      {adding && (
        <div className="border-2 border-amber-400 bg-amber-50/50 rounded-lg p-3 mb-3 flex flex-wrap items-center gap-2">
          <input
            type="text"
            placeholder="Código (ex: 33302)"
            value={newEntry.codigo}
            onChange={(e) =>
              setNewEntry({ ...newEntry, codigo: e.target.value })
            }
            autoFocus
            className="px-3 py-2 text-sm border border-stone-300 rounded-md bg-white font-mono w-40 focus:outline-none focus:ring-2 focus:ring-amber-700/30"
          />
          <input
            type="text"
            placeholder="Nome (ex: MARROM)"
            value={newEntry.nome}
            onChange={(e) => setNewEntry({ ...newEntry, nome: e.target.value })}
            className="px-3 py-2 text-sm border border-stone-300 rounded-md bg-white flex-1 min-w-[180px] focus:outline-none focus:ring-2 focus:ring-amber-700/30"
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
                  isEditing ? "bg-amber-50/40" : "hover:bg-stone-50/50"
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
                      className="px-2 py-1.5 text-sm border border-stone-300 rounded bg-white font-mono w-full focus:outline-none focus:ring-2 focus:ring-amber-700/30"
                    />
                    <input
                      type="text"
                      value={draft.nome}
                      onChange={(e) =>
                        setDraft({ ...draft, nome: e.target.value })
                      }
                      className="px-2 py-1.5 text-sm border border-stone-300 rounded bg-white focus:outline-none focus:ring-2 focus:ring-amber-700/30"
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

function TaxasModule({ taxasBlu, onSaveTaxasBlu, taxasPV, onSaveTaxasPV }) {
  // Aba ativa (qual maquininha está sendo editada)
  const [maquininhaAtiva, setMaquininhaAtiva] = useState("blu");
  // Estado de "rascunho" — a usuária edita aqui antes de salvar
  const [rascunho, setRascunho] = useState(taxasBlu);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");

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
    setSaveStatus(ok ? "Salvo" : "Erro ao salvar");
    setTimeout(() => setSaveStatus(""), 2500);
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
    setSaveStatus(ok ? "Salvo" : "Erro ao salvar");
    setTimeout(() => setSaveStatus(""), 2500);
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8 border-b border-stone-200 pb-6">
        <div className="flex items-baseline gap-3 mb-2">
          <span className="text-xs uppercase tracking-[0.2em] text-amber-800 font-semibold">
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
        <div className="flex items-start gap-2 mt-3 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          <Users className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>
            <strong>Tabelas salvas no seu navegador.</strong> Quando o contrato mudar,
            é só atualizar os valores aqui e salvar.
          </span>
        </div>
      </div>

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
                          className="w-full pl-3 pr-8 py-1.5 text-sm text-right border border-stone-300 rounded bg-white font-mono focus:outline-none focus:ring-2 focus:ring-amber-700/30 focus:border-amber-700"
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
                        className="w-full pl-3 pr-8 py-1.5 text-sm text-right border border-stone-300 rounded bg-white font-mono focus:outline-none focus:ring-2 focus:ring-amber-700/30 focus:border-amber-700"
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

// ============================================================
// MÓDULO: CONCILIAÇÃO FINANCEIRA
// ============================================================

function FinanceiroModule() {
  const [bancoSelecionado, setBancoSelecionado] = useState(null);

  const trocarBanco = () => {
    setBancoSelecionado(null);
  };

  // === SELEÇÃO DE BANCO ===
  if (!bancoSelecionado) {
    return (
      <div className="max-w-5xl mx-auto">
        <div className="mb-8 border-b border-stone-200 pb-6">
          <div className="flex items-baseline gap-3 mb-2">
            <span className="text-xs uppercase tracking-[0.2em] text-amber-800 font-semibold">
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
              onClick={() => !banco.emBreve && setBancoSelecionado(banco)}
              disabled={banco.emBreve}
              className={`p-6 border-2 rounded-lg text-left transition-all ${
                banco.emBreve
                  ? "border-stone-200 bg-stone-50 cursor-not-allowed opacity-60"
                  : "border-stone-300 bg-white hover:border-amber-700 hover:shadow-md"
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
                      banco.emBreve ? "text-stone-400" : "text-amber-800"
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

        <div className="mt-8 bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900">
          <p className="font-semibold mb-1">⚠️ Como funciona</p>
          <ul className="list-disc list-inside space-y-1 text-xs">
            <li>Suba o relatório de lançamentos do ERP (PDF ou Excel).</li>
            <li>Suba o extrato bancário do mesmo período (PDF, Excel ou CSV).</li>
            <li>
              O app casa lançamentos pelo <strong>valor</strong> e{" "}
              <strong>data</strong> (com tolerância de {TOLERANCIA_DIAS} dias).
            </li>
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
          <span className="text-xs uppercase tracking-[0.2em] text-amber-800 font-semibold">
            Módulo 02
          </span>
          <span className="text-stone-300">—</span>
          <span className="text-xs uppercase tracking-wider text-stone-500">
            {banco.nome}
          </span>
          <button
            onClick={onTrocar}
            className="ml-2 text-xs text-amber-800 hover:text-amber-900 underline"
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
                    ? "bg-white text-amber-900 shadow-sm"
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
                className="w-full pl-9 pr-3 py-2 text-sm border border-stone-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-amber-700/30 focus:border-amber-700"
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
        <div className="text-center py-16 bg-gradient-to-b from-amber-50/40 to-transparent rounded-lg border border-stone-200">
          <CircleDollarSign className="w-10 h-10 text-amber-800 mx-auto mb-3" />
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
          <span className="text-xs uppercase tracking-[0.2em] text-amber-800 font-semibold">
            Módulo 02
          </span>
          <span className="text-stone-300">—</span>
          <span className="text-xs uppercase tracking-wider text-stone-500">
            {banco.nome}
          </span>
          <button
            onClick={onTrocar}
            className="ml-2 text-xs text-amber-800 hover:text-amber-900 underline"
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
                    ? "bg-white text-amber-900 shadow-sm"
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
                className="w-full pl-9 pr-3 py-2 text-sm border border-stone-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-amber-700/30 focus:border-amber-700"
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
            className="text-xs uppercase tracking-[0.2em] text-amber-800 font-semibold hover:text-amber-900 flex items-center gap-1"
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
                className="w-full pl-9 pr-3 py-2 text-sm border border-stone-300 rounded bg-white focus:outline-none focus:ring-2 focus:ring-amber-700/30 focus:border-amber-700"
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
                  ? "bg-white text-amber-900 shadow-sm"
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
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-700 mt-0.5 flex-shrink-0" />
        <div className="text-xs text-amber-900">
          <p className="font-semibold mb-1">PIX recebidos na Pague Veloz sem venda correspondente no ERP.</p>
          <p>Pode ser PIX VELOZ VPP ou PIX VELOZ SS (não Express), ou venda esquecida no sistema.</p>
        </div>
      </div>

      {items.map((p, i) => (
        <div key={i} className="border border-amber-200 bg-white rounded-lg p-4">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-md bg-amber-100 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-5 h-5 text-amber-700" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 mb-1 flex-wrap">
                <span className="text-xs font-mono text-stone-500">{formatarData(p.dataPix)}</span>
                <span className="text-[10px] uppercase tracking-wider bg-amber-100 text-amber-900 px-1.5 py-0.5 rounded font-semibold border border-amber-300">
                  PIX sem correspondente
                </span>
              </div>
              <h3 className="font-serif font-semibold text-stone-900 truncate">
                {p.pagante || "(sem pagante informado)"}
              </h3>
              <div className="mt-2 text-xs px-3 py-2 rounded border bg-amber-50 border-amber-200 text-amber-900">
                <strong>Motivo:</strong> {p.motivoDetalhe}
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="font-serif text-xl font-bold text-amber-700">
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
    amber: "bg-amber-100 text-amber-900 border-amber-300",
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
          amber: { borda: "border-amber-200", bg: "bg-amber-100", icone: "text-amber-700", valor: "text-amber-700", caixa: "bg-amber-50 border-amber-200 text-amber-900" },
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
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-amber-700 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-amber-900">
            <p className="font-semibold mb-1">Vendas na {nomeMaquininha} que não foram lançadas no ERP.</p>
            <p>Cada venda mostra o motivo da divergência: NSU divergente nos dois arquivos, sem correspondente no ERP, valor diferente ou mês diferente.</p>
          </div>
        </div>
      )}

      {items.map((v, i) => {
        // Para canceladas: cor stone fixa. Para divergências: cor depende do motivo.
        const paletas = {
          red: { borda: "border-red-200", bg: "bg-red-100", icone: "text-red-700", valor: "text-red-700", caixa: "bg-red-50 border-red-200 text-red-900" },
          amber: { borda: "border-amber-200", bg: "bg-amber-100", icone: "text-amber-700", valor: "text-amber-700", caixa: "bg-amber-50 border-amber-200 text-amber-900" },
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
          ? "border-amber-200 bg-amber-50/30"
          : "border-emerald-200 bg-white";
        return (
          <div key={i} className={`border rounded-lg overflow-hidden ${corBorda}`}>
            <button
              onClick={() => setExpanded(expanded === i ? null : i)}
              className="w-full flex items-start p-4 gap-4 text-left hover:bg-stone-50/30 transition-colors"
            >
              <div
                className={`w-10 h-10 rounded-md flex items-center justify-center flex-shrink-0 ${
                  isAviso ? "bg-amber-100" : "bg-emerald-100"
                }`}
              >
                {isAviso ? (
                  <AlertCircle className="w-5 h-5 text-amber-700" />
                ) : (
                  <CheckCircle2 className="w-5 h-5 text-emerald-700" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="text-xs font-mono text-stone-500">
                    {c.erp.dataStr}
                    {c.diffDias > 0 && (
                      <span className="text-amber-700 ml-1">
                        ⇄ {c.banco.dataStr}
                      </span>
                    )}
                  </span>
                  {c.conferir && (
                    <span className="text-[10px] uppercase tracking-wider bg-amber-200 text-amber-900 px-1.5 py-0.5 rounded font-semibold">
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
    amber: { borda: "border-amber-200", bg: "bg-amber-50/30", icone: "text-amber-700", iconeBg: "bg-amber-100" },
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

function PlaceholderModule({ title, description }) {
  return (
    <div className="max-w-3xl mx-auto text-center py-20">
      <div className="inline-block p-4 bg-amber-50 rounded-full mb-4">
        <Settings className="w-8 h-8 text-amber-800" />
      </div>
      <h1 className="font-serif text-3xl font-bold text-stone-900 mb-2">{title}</h1>
      <p className="text-stone-600">{description}</p>
      <p className="text-xs uppercase tracking-widest text-amber-800 font-semibold mt-6">
        Em breve
      </p>
    </div>
  );
}

// ============================================================
// APP SHELL
// ============================================================

export default function App() {
  const [activeModule, setActiveModule] = useState("conciliacao");
  const { table: colorTable, save: saveColorTable, loaded: colorsLoaded } = useColorTable();
  const { taxas: taxasBlu, save: saveTaxasBlu, loaded: taxasBluLoaded } = useTaxasBlu();
  const { taxas: taxasPV, save: saveTaxasPV, loaded: taxasPVLoaded } = useTaxasPagueVeloz();

  const modules = [
    {
      id: "conciliacao",
      label: "Conciliação dos Pedidos com os Negativos do Sistema",
      icon: GitCompare,
      available: true,
    },
    {
      id: "cores",
      label: "Tabela de Cores",
      icon: Palette,
      available: true,
    },
    {
      id: "financeiro",
      label: "Conciliação Financeira",
      icon: CircleDollarSign,
      available: true,
    },
    {
      id: "taxas",
      label: "Tabelas de Taxas de Cartões",
      icon: CreditCard,
      available: true,
    },
    {
      id: "estoque",
      label: "Gestão de Estoque",
      icon: Package,
      available: false,
    },
    {
      id: "relatorios",
      label: "Relatórios",
      icon: BarChart3,
      available: false,
    },
    {
      id: "config",
      label: "Configurações",
      icon: Settings,
      available: false,
    },
  ];

  return (
    <div className="min-h-screen bg-stone-50" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700;9..144,800&family=Inter:wght@400;500;600;700&display=swap');
        .font-serif { font-family: 'Fraunces', Georgia, serif; }
      `}</style>

      {/* Top Bar */}
      <header className="bg-stone-900 text-stone-100 border-b-4 border-amber-700">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-md bg-amber-700 flex items-center justify-center">
              <Armchair className="w-5 h-5 text-stone-100" />
            </div>
            <div>
              <h1 className="font-serif text-xl font-bold tracking-tight leading-none">
                Sofá Show
              </h1>
              <p className="text-[10px] uppercase tracking-[0.2em] text-amber-300/80 mt-0.5">
                Operações
              </p>
            </div>
          </div>
          <div className="ml-auto text-xs text-stone-400 hidden md:block">
            21/04/2026
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <aside className="w-64 bg-white border-r border-stone-200 min-h-[calc(100vh-73px)] py-6 px-3 hidden md:block">
          <p className="text-[10px] uppercase tracking-[0.2em] text-stone-500 font-semibold px-3 mb-3">
            Módulos
          </p>
          <nav className="space-y-1">
            {modules.map((m) => (
              <button
                key={m.id}
                onClick={() => m.available && setActiveModule(m.id)}
                disabled={!m.available}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm text-left transition-colors ${
                  activeModule === m.id
                    ? "bg-amber-50 text-amber-900 font-semibold"
                    : m.available
                    ? "text-stone-700 hover:bg-stone-100"
                    : "text-stone-400 cursor-not-allowed"
                }`}
              >
                <m.icon className="w-4 h-4 flex-shrink-0" />
                <span className="flex-1">{m.label}</span>
                {!m.available && (
                  <span className="text-[9px] uppercase tracking-wider bg-stone-200 text-stone-600 px-1.5 py-0.5 rounded">
                    Em breve
                  </span>
                )}
              </button>
            ))}
          </nav>
        </aside>

        {/* Mobile tabs */}
        <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-stone-200 flex z-10">
          {modules
            .filter((m) => m.available)
            .map((m) => (
              <button
                key={m.id}
                onClick={() => setActiveModule(m.id)}
                className={`flex-1 flex flex-col items-center py-2 text-[10px] ${
                  activeModule === m.id
                    ? "text-amber-900 font-semibold"
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
          {activeModule === "conciliacao" && (
            <ConciliacaoModule colorTable={colorTable} />
          )}
          {activeModule === "cores" && colorsLoaded && (
            <ColorTableModule table={colorTable} onSave={saveColorTable} />
          )}
          {activeModule === "cores" && !colorsLoaded && (
            <div className="flex items-center gap-2 text-stone-500 justify-center py-20">
              <Loader2 className="w-5 h-5 animate-spin" />
              Carregando tabela…
            </div>
          )}
          {activeModule === "financeiro" && <FinanceiroModule />}
          {activeModule === "taxas" && taxasBluLoaded && taxasPVLoaded && (
            <TaxasModule
              taxasBlu={taxasBlu}
              onSaveTaxasBlu={saveTaxasBlu}
              taxasPV={taxasPV}
              onSaveTaxasPV={saveTaxasPV}
            />
          )}
          {activeModule === "taxas" && (!taxasBluLoaded || !taxasPVLoaded) && (
            <div className="flex items-center gap-2 text-stone-500 justify-center py-20">
              <Loader2 className="w-5 h-5 animate-spin" />
              Carregando taxas…
            </div>
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
    </div>
  );
}
