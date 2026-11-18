(function () {
  "use strict";

  /* =========================================================
     CONFIGURAÇÕES DE SEGURANÇA
     ========================================================= */
  // S2 · Login de funcionários (Firebase Authentication, e-mail/senha).
  // Com "true", o quadro só carrega depois que um funcionário entra.
  var EXIGIR_LOGIN = true;

  // S6 · Remove pedidos que versões antigas do sistema guardavam no
  // navegador (dados de clientes sem criptografia).
  try { localStorage.removeItem("chaymdf_pedidos_v1"); } catch (erro) { /* armazenamento indisponível */ }

  /* =========================================================
     TEMA (diurno / noturno) — aplicado primeiro para evitar "piscar"
     ========================================================= */
  var CHAVE_TEMA = "chaymdf_tema";

  function lerTemaSalvo() {
    try {
      return localStorage.getItem(CHAVE_TEMA) === "noturno" ? "noturno" : "diurno";
    } catch (erro) {
      return "diurno"; // padrão quando o armazenamento não está disponível
    }
  }

  function aplicarTema(tema) {
    if (tema === "noturno") {
      document.documentElement.setAttribute("data-tema", "noturno");
    } else {
      document.documentElement.removeAttribute("data-tema");
    }
    var btnTema = document.getElementById("btnTema");
    if (btnTema) {
      btnTema.setAttribute("aria-pressed", tema === "noturno" ? "true" : "false");
      document.getElementById("btnTemaTexto").textContent =
        tema === "noturno" ? "Modo diurno" : "Modo noturno";
    }
  }

  var temaAtual = lerTemaSalvo();
  aplicarTema(temaAtual);

  document.getElementById("btnTema").addEventListener("click", function () {
    temaAtual = temaAtual === "noturno" ? "diurno" : "noturno";
    aplicarTema(temaAtual);
    try {
      localStorage.setItem(CHAVE_TEMA, temaAtual);
    } catch (erro) {
      console.warn("Não foi possível salvar o tema:", erro);
    }
  });

  /* =========================================================
     ESTADO
     ========================================================= */
  var pedidos = [];                 // preenchido em tempo real pelo Firestore
  var estadoConexao = "carregando"; // "carregando" | "ok" | "erro"
  var colecaoPedidos = null;        // referência à coleção "pedidos" no Firestore
  var pararEscuta = null;           // encerra o onSnapshot (usado ao sair)
  var STATUS_VALIDOS = ["lancamento", "andamento", "finalizados"];

  /* =========================================================
     ELEMENTOS
     ========================================================= */
  var board = document.getElementById("board");
  var listas = {
    lancamento: document.querySelector('[data-lista="lancamento"]'),
    andamento: document.querySelector('[data-lista="andamento"]'),
    finalizados: document.querySelector('[data-lista="finalizados"]')
  };
  var contagens = {
    lancamento: document.querySelector('[data-contagem="lancamento"]'),
    andamento: document.querySelector('[data-contagem="andamento"]'),
    finalizados: document.querySelector('[data-contagem="finalizados"]')
  };

  var modalOverlay = document.getElementById("modalOverlay");
  var formComanda = document.getElementById("formComanda");
  var btnNovaComanda = document.getElementById("btnNovaComanda");
  var btnFecharModalX = document.getElementById("btnFecharModalX");
  var btnCancelar = document.getElementById("btnCancelar");

  var toast = document.getElementById("toast");
  var toastTexto = document.getElementById("toastTexto");
  var toastTimeout = null;

  var mensagensVazio = {
    lancamento: "Nenhum pedido em lançamento.<br>Clique em \"+ Nova Comanda\" para cadastrar.",
    andamento: "Arraste um cartão aqui para<br>colocá-lo em produção.",
    finalizados: "Os pedidos prontos para<br>entrega aparecem aqui."
  };

  /* =========================================================
     PERSISTÊNCIA · CLOUD FIRESTORE
     Coleção "pedidos": cada documento é um pedido com
     { nome, descricao, quantidade, prazo, status, criadoEm }
     ========================================================= */
  function iniciarApp() {
    if (typeof firebase === "undefined" || !window.FIREBASE_CONFIG) {
      falhaConexao("SDK do Firebase ou firebase-config.js não carregou.");
      return;
    }

    firebase.initializeApp(window.FIREBASE_CONFIG);

    if (!EXIGIR_LOGIN) {
      iniciarFirestore();
      return;
    }

    // S2 · Só conecta ao banco depois que o funcionário entrar.
    // O Firebase lembra o login: quem já entrou não precisa digitar de novo.
    firebase.auth().onAuthStateChanged(function (usuario) {
      if (usuario) {
        esconderLogin(usuario);
        iniciarFirestore();
      } else {
        pararFirestore();
        mostrarLogin();
      }
    });
  }

  function iniciarFirestore() {
    if (pararEscuta) return; // já conectado
    colecaoPedidos = firebase.firestore().collection("pedidos");

    // Escuta em tempo real: roda agora e a cada mudança feita por QUALQUER usuário
    pararEscuta = colecaoPedidos.onSnapshot(function (snapshot) {
      // S3 · Documentos fora do formato são ignorados em vez de travar o quadro
      pedidos = snapshot.docs.map(normalizarPedido).filter(Boolean);
      // Mais recentes primeiro
      pedidos.sort(function (a, b) { return b.criadoEm - a.criadoEm; });

      estadoConexao = "ok";
      renderizarQuadro();
    }, function (erro) {
      falhaConexao(erro);
    });
  }

  function pararFirestore() {
    if (pararEscuta) pararEscuta();
    pararEscuta = null;
    colecaoPedidos = null;
    pedidos = [];
    estadoConexao = "carregando";
    renderizarQuadro();
  }

  // S3 · Nunca confia no formato do que vem do banco
  function normalizarPedido(doc) {
    // "estimate": enquanto o servidor não confirma a data, usa a hora local
    var d = doc.data({ serverTimestamps: "estimate" }) || {};

    if (typeof d.nome !== "string" || typeof d.prazo !== "string" ||
        STATUS_VALIDOS.indexOf(d.status) === -1) {
      console.warn("Pedido ignorado (formato inválido):", doc.id);
      return null;
    }

    return {
      id: doc.id,
      nome: d.nome,
      descricao: typeof d.descricao === "string" ? d.descricao : "",
      quantidade: Number.isInteger(d.quantidade) ? d.quantidade : 0,
      prazo: d.prazo,
      status: d.status,
      criadoEm: (d.criadoEm && typeof d.criadoEm.toMillis === "function") ? d.criadoEm.toMillis() : 0
    };
  }

  function falhaConexao(erro) {
    console.error("Erro no Firestore:", erro);
    estadoConexao = "erro";
    renderizarQuadro();
    exibirToast(mensagemDeErro(erro));
  }

  function mensagemDeErro(erro) {
    if (erro && erro.code === "permission-denied") {
      return EXIGIR_LOGIN
        ? "Seu usuário não tem permissão. Peça ao administrador para cadastrá-lo como funcionário."
        : "Sem permissão no banco de dados (verifique as regras do Firestore).";
    }
    if (erro && erro.code === "unavailable") {
      return "Sem conexão com o banco de dados. Verifique a internet.";
    }
    return "Não foi possível acessar o banco de dados.";
  }

  /* =========================================================
     RENDERIZAÇÃO DO QUADRO
     ========================================================= */
  function renderizarQuadro() {
    Object.keys(listas).forEach(function (status) {
      var lista = listas[status];
      lista.innerHTML = "";

      // Enquanto carrega (ou se falhar), mostra um aviso em vez dos cartões
      if (estadoConexao !== "ok") {
        contagens[status].textContent = "–";
        var aviso = document.createElement("div");
        aviso.className = "coluna-vazia";
        aviso.textContent = estadoConexao === "carregando"
          ? "Carregando pedidos..."
          : "Não foi possível carregar os pedidos.";
        lista.appendChild(aviso);
        return;
      }

      var pedidosDaColuna = pedidos.filter(function (p) { return p.status === status; });
      contagens[status].textContent = pedidosDaColuna.length;

      if (pedidosDaColuna.length === 0) {
        var vazio = document.createElement("div");
        vazio.className = "coluna-vazia";
        vazio.innerHTML = mensagensVazio[status];
        lista.appendChild(vazio);
        return;
      }

      pedidosDaColuna.forEach(function (pedido) {
        lista.appendChild(criarCartao(pedido));
      });
    });
  }

  function criarCartao(pedido) {
    var cartao = document.createElement("article");
    cartao.className = "cartao";
    cartao.draggable = true;
    cartao.dataset.id = pedido.id;
    cartao.setAttribute("aria-roledescription", "cartão de pedido arrastável");

    cartao.innerHTML =
      '<div class="cartao-topo">' +
        '<span class="cartao-nome"></span>' +
        '<button class="cartao-remover" type="button" title="Remover pedido" aria-label="Remover pedido">&times;</button>' +
      '</div>' +
      '<p class="cartao-descricao"></p>' +
      '<div class="cartao-rodape">' +
        '<span class="badge badge-qtd"></span>' +
        '<span class="badge badge-prazo"></span>' +
      '</div>';

    // Inserção de texto via textContent (evita problemas de escaping/HTML)
    cartao.querySelector(".cartao-nome").textContent = pedido.nome;
    cartao.querySelector(".cartao-descricao").textContent = pedido.descricao;
    cartao.querySelector(".badge-qtd").textContent = pedido.quantidade + "x peça(s)";
    cartao.querySelector(".badge-prazo").textContent = pedido.prazo;

    // Remover pedido
    cartao.querySelector(".cartao-remover").addEventListener("click", function (evento) {
      evento.stopPropagation();
      removerPedido(pedido);
    });

    // ---- Drag and Drop (HTML5 API) ----
    cartao.addEventListener("dragstart", function (evento) {
      evento.dataTransfer.setData("text/plain", pedido.id);
      evento.dataTransfer.effectAllowed = "move";
      // pequeno timeout para o estilo "arrastando" não sumir o cartão antes do navegador tirar o snapshot
      setTimeout(function () { cartao.classList.add("arrastando"); }, 0);
    });

    cartao.addEventListener("dragend", function () {
      cartao.classList.remove("arrastando");
    });

    return cartao;
  }

  function removerPedido(pedido) {
    // O banco é compartilhado: confirma antes de apagar para todos
    if (!window.confirm("Remover o pedido \"" + pedido.nome + "\"? Esta ação não pode ser desfeita.")) return;

    colecaoPedidos.doc(pedido.id).delete()
      .then(function () { exibirToast("Pedido removido."); })
      .catch(function (erro) {
        console.error("Erro ao remover:", erro);
        exibirToast(mensagemDeErro(erro));
      });
    // O quadro se atualiza sozinho pelo onSnapshot
  }

  /* =========================================================
     DRAG AND DROP — COLUNAS (destino)
     ========================================================= */
  document.querySelectorAll(".coluna").forEach(function (coluna) {
    var status = coluna.dataset.status;

    coluna.addEventListener("dragover", function (evento) {
      evento.preventDefault(); // necessário para permitir o "drop"
      evento.dataTransfer.dropEffect = "move";
      coluna.classList.add("drag-over");
    });

    coluna.addEventListener("dragleave", function (evento) {
      // só remove o destaque se realmente saiu da coluna (não de um filho interno)
      if (!coluna.contains(evento.relatedTarget)) {
        coluna.classList.remove("drag-over");
      }
    });

    coluna.addEventListener("drop", function (evento) {
      evento.preventDefault();
      coluna.classList.remove("drag-over");

      var id = evento.dataTransfer.getData("text/plain");
      var pedido = pedidos.find(function (p) { return p.id === id; });
      if (!pedido) return;

      if (pedido.status !== status) {
        colecaoPedidos.doc(id).update({ status: status })
          .catch(function (erro) {
            console.error("Erro ao mover:", erro);
            exibirToast(mensagemDeErro(erro));
          });
        exibirToast("Pedido movido para \"" + rotuloStatus(status) + "\".");
      }
    });
  });

  function rotuloStatus(status) {
    return { lancamento: "Lançamento", andamento: "Andamento", finalizados: "Finalizados" }[status] || status;
  }

  /* =========================================================
     MODAL · NOVA COMANDA
     ========================================================= */
  function abrirModal() {
    modalOverlay.classList.add("aberto");
    document.body.style.overflow = "hidden";
    limparErrosFormulario();
    formComanda.reset();
    setTimeout(function () { document.getElementById("campoNome").focus(); }, 150);
  }

  function fecharModal() {
    modalOverlay.classList.remove("aberto");
    document.body.style.overflow = "";
  }

  btnNovaComanda.addEventListener("click", abrirModal);
  btnFecharModalX.addEventListener("click", fecharModal);
  btnCancelar.addEventListener("click", fecharModal);

  // Fecha ao clicar fora do conteúdo do modal
  modalOverlay.addEventListener("click", function (evento) {
    if (evento.target === modalOverlay) fecharModal();
  });

  // Fecha com a tecla ESC
  document.addEventListener("keydown", function (evento) {
    if (evento.key === "Escape" && modalOverlay.classList.contains("aberto")) {
      fecharModal();
    }
  });

  function limparErrosFormulario() {
    document.querySelectorAll(".campo").forEach(function (campo) {
      campo.classList.remove("invalido");
    });
  }

  /* =========================================================
     VALIDAÇÃO E SUBMISSÃO DO FORMULÁRIO
     ========================================================= */
  formComanda.addEventListener("submit", function (evento) {
    evento.preventDefault();
    limparErrosFormulario();

    var nome = document.getElementById("campoNome").value.trim();
    var descricao = document.getElementById("campoDescricao").value.trim();
    var quantidadeStr = document.getElementById("campoQuantidade").value.trim();
    var prazo = document.getElementById("campoPrazo").value.trim();
    var quantidade = parseInt(quantidadeStr, 10);

    var valido = true;

    if (!nome) { marcarInvalido("nome"); valido = false; }
    if (!descricao) { marcarInvalido("descricao"); valido = false; }
    if (!quantidadeStr || isNaN(quantidade) || quantidade < 1) { marcarInvalido("quantidade"); valido = false; }
    if (!dataValida(prazo)) { marcarInvalido("prazo"); valido = false; }

    if (!valido) return;

    if (!colecaoPedidos) {
      exibirToast("Sem conexão com o banco de dados.");
      return;
    }

    colecaoPedidos.add({
      nome: nome,
      descricao: descricao,
      quantidade: quantidade,
      prazo: prazo,
      status: "lancamento", // toda nova comanda entra em Lançamento
      criadoEm: firebase.firestore.FieldValue.serverTimestamp()
    }).catch(function (erro) {
      console.error("Erro ao salvar:", erro);
      exibirToast(mensagemDeErro(erro));
    });

    // O Firestore mostra o cartão na hora (antes mesmo da confirmação do servidor)
    fecharModal();
    exibirToast("Comanda \"" + nome + "\" criada em Lançamento.");
  });

  function marcarInvalido(nomeCampo) {
    var campo = document.querySelector('[data-campo="' + nomeCampo + '"]');
    if (campo) campo.classList.add("invalido");
  }

  /* =========================================================
     MÁSCARA DE DATA · DD/MM/AAAA
     ========================================================= */
  var campoPrazo = document.getElementById("campoPrazo");

  // Bloqueia letras e símbolos já na digitação (as barras são automáticas)
  campoPrazo.addEventListener("beforeinput", function (evento) {
    if (evento.data && /\D/.test(evento.data) && evento.inputType !== "insertFromPaste") {
      evento.preventDefault();
    }
  });

  // Reformata a cada alteração (digitação, colar, apagar)
  campoPrazo.addEventListener("input", function () {
    campoPrazo.value = formatarData(campoPrazo.value);
  });

  // Monta "DD/MM/AAAA HH:MM" a partir de até 12 dígitos
  function formatarData(texto) {
    var n = texto.replace(/\D/g, "").slice(0, 12); // só dígitos, no máximo 12
    var resultado = n.slice(0, 2);
    if (n.length > 2)  resultado += "/" + n.slice(2, 4);   // mês
    if (n.length > 4)  resultado += "/" + n.slice(4, 8);   // ano
    if (n.length > 8)  resultado += " " + n.slice(8, 10);  // hora
    if (n.length > 10) resultado += ":" + n.slice(10, 12); // minutos
    return resultado;
  }

  // Confere o formato, se a data existe no calendário (ex.: 31/02 é inválido)
  // e se a hora está entre 00:00 e 23:59
  function dataValida(texto) {
    var partes = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/.exec(texto);
    if (!partes) return false;

    var dia = parseInt(partes[1], 10);
    var mes = parseInt(partes[2], 10);
    var ano = parseInt(partes[3], 10);
    var hora = parseInt(partes[4], 10);
    var minuto = parseInt(partes[5], 10);
    if (ano < 1900 || hora > 23 || minuto > 59) return false;

    var data = new Date(ano, mes - 1, dia);
    return data.getFullYear() === ano &&
           data.getMonth() === mes - 1 &&
           data.getDate() === dia;
  }

  /* =========================================================
     LOGIN DE FUNCIONÁRIOS (S2)
     ========================================================= */
  var telaLogin = document.getElementById("telaLogin");
  var formLogin = document.getElementById("formLogin");
  var loginErro = document.getElementById("loginErro");
  var btnEntrar = document.getElementById("btnEntrar");
  var btnSair = document.getElementById("btnSair");

  function mostrarLogin() {
    fecharModal();
    telaLogin.hidden = false;
    btnSair.hidden = true;
    loginErro.textContent = "";
    setTimeout(function () { document.getElementById("loginEmail").focus(); }, 50);
  }

  function esconderLogin(usuario) {
    telaLogin.hidden = true;
    btnSair.hidden = false;
    btnSair.title = "Sair (" + (usuario.email || "funcionário") + ")";
    formLogin.reset();
  }

  formLogin.addEventListener("submit", function (evento) {
    evento.preventDefault();
    var email = document.getElementById("loginEmail").value.trim();
    var senha = document.getElementById("loginSenha").value;
    if (!email || !senha) {
      loginErro.textContent = "Informe e-mail e senha.";
      return;
    }

    btnEntrar.disabled = true;
    btnEntrar.textContent = "Entrando...";
    loginErro.textContent = "";

    // Se der certo, o onAuthStateChanged esconde a tela e carrega o quadro
    firebase.auth().signInWithEmailAndPassword(email, senha)
      .catch(function (erro) {
        loginErro.textContent = mensagemErroLogin(erro);
      })
      .then(function () {
        btnEntrar.disabled = false;
        btnEntrar.textContent = "Entrar";
      });
  });

  btnSair.addEventListener("click", function () {
    firebase.auth().signOut();
  });

  function mensagemErroLogin(erro) {
    switch (erro && erro.code) {
      case "auth/invalid-credential":
      case "auth/invalid-login-credentials":
      case "auth/wrong-password":
      case "auth/user-not-found":
      case "auth/invalid-email":
        return "E-mail ou senha incorretos.";
      case "auth/user-disabled":
        return "Este usuário foi desativado.";
      case "auth/too-many-requests":
        return "Muitas tentativas. Aguarde alguns minutos e tente de novo.";
      case "auth/network-request-failed":
        return "Sem conexão. Verifique a internet.";
      default:
        console.error("Erro no login:", erro);
        return "Não foi possível entrar. Tente novamente.";
    }
  }

  /* =========================================================
     TOAST
     ========================================================= */
  function exibirToast(mensagem) {
    toastTexto.textContent = mensagem;
    toast.classList.add("visivel");
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(function () {
      toast.classList.remove("visivel");
    }, 2600);
  }

  /* =========================================================
     INICIALIZAÇÃO
     ========================================================= */
  renderizarQuadro();  // mostra "Carregando pedidos..."
  iniciarApp();        // inicia o Firebase, pede login e conecta ao banco

})();
