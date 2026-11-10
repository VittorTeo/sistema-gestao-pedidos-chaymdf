(function () {
  "use strict";

  /* =========================================================
     ESTADO
     ========================================================= */
  var CHAVE_ARMAZENAMENTO = "chaymdf_pedidos_v1";

  // Dados de exemplo para o MVP já iniciar com contexto visual
  var pedidosPadrao = [
    {
      id: gerarId(),
      nome: "Marcenaria Horizonte",
      descricao: "12 portas de armário 45x70cm, MDF branco TX 15mm, corte reto com furação para dobradiça.",
      quantidade: 12,
      prazo: "5 dias úteis",
      status: "lancamento"
    },
    {
      id: gerarId(),
      nome: "Loja Casa Nova - Balcão",
      descricao: "Tampo de balcão 180x60cm, MDF freijó 25mm, corte com rebaixo para pia.",
      quantidade: 1,
      prazo: "22/09",
      status: "andamento"
    },
    {
      id: gerarId(),
      nome: "Cliente João Pereira",
      descricao: "6 prateleiras 60x30cm, MDF branco 15mm, cantos arredondados.",
      quantidade: 6,
      prazo: "Retirada hoje",
      status: "finalizados"
    }
  ];

  var pedidos = carregarPedidos();

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
     PERSISTÊNCIA (localStorage)
     ========================================================= */
  function carregarPedidos() {
    try {
      var salvos = localStorage.getItem(CHAVE_ARMAZENAMENTO);
      if (salvos) {
        var lista = JSON.parse(salvos);
        if (Array.isArray(lista) && lista.length > 0) return lista;
      }
    } catch (erro) {
      console.warn("Não foi possível ler o armazenamento local:", erro);
    }
    return pedidosPadrao;
  }

  function salvarPedidos() {
    try {
      localStorage.setItem(CHAVE_ARMAZENAMENTO, JSON.stringify(pedidos));
    } catch (erro) {
      console.warn("Não foi possível salvar no armazenamento local:", erro);
    }
  }

  function gerarId() {
    return "p_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  /* =========================================================
     RENDERIZAÇÃO DO QUADRO
     ========================================================= */
  function renderizarQuadro() {
    Object.keys(listas).forEach(function (status) {
      var lista = listas[status];
      lista.innerHTML = "";

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
      removerPedido(pedido.id);
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

  function removerPedido(id) {
    pedidos = pedidos.filter(function (p) { return p.id !== id; });
    salvarPedidos();
    renderizarQuadro();
    exibirToast("Pedido removido.");
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
        pedido.status = status;
        salvarPedidos();
        renderizarQuadro();
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
    if (!prazo) { marcarInvalido("prazo"); valido = false; }

    if (!valido) return;

    var novoPedido = {
      id: gerarId(),
      nome: nome,
      descricao: descricao,
      quantidade: quantidade,
      prazo: prazo,
      status: "lancamento" // toda nova comanda entra em Lançamento
    };

    pedidos.unshift(novoPedido);
    salvarPedidos();
    renderizarQuadro();
    fecharModal();
    exibirToast("Comanda \"" + nome + "\" criada em Lançamento.");
  });

  function marcarInvalido(nomeCampo) {
    var campo = document.querySelector('[data-campo="' + nomeCampo + '"]');
    if (campo) campo.classList.add("invalido");
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
  renderizarQuadro();

})();
