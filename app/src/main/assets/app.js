/* 悟空 · AI 工作平台 —— 前端逻辑 */
(function () {
  "use strict";

  var HOST = window.Android || null;
  var KEY = "wukong_state_v1";

  var MODELS = [
    { id: "openai", name: "GPT-OSS 20B", desc: "免密钥通道 · 推理型模型，直接可用" }
  ];

  var state = {
    mode: "standard",
    model: "openai",
    user: null,
    convs: [],
    current: null,
    streaming: null,
    pendingImage: null,
    pendingImageNote: "",
    imageTarget: "home",
    loginCb: null
  };

  var $ = function (id) { return document.getElementById(id); };

  /* ---------------- 存储 ---------------- */
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return;
      var s = JSON.parse(raw);
      state.mode = s.mode || "standard";
      state.model = "openai";
      state.user = s.user || null;
      state.convs = Array.isArray(s.convs) ? s.convs : [];
    } catch (e) {}
  }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        mode: state.mode, model: state.model,
        user: state.user, convs: state.convs
      }));
    } catch (e) {
      // 容量超限时丢弃旧会话里的图片
      state.convs.forEach(function (c, i) {
        if (i < state.convs.length - 1) c.messages.forEach(function (m) { if (m.image) m.image = ""; });
      });
      try {
        localStorage.setItem(KEY, JSON.stringify({
          mode: state.mode, model: state.model,
          user: state.user, convs: state.convs
        }));
      } catch (e2) {}
    }
  }

  function modelName(id) {
    for (var i = 0; i < MODELS.length; i++) if (MODELS[i].id === id) return MODELS[i].name;
    return id;
  }

  /* ---------------- 通用 UI ---------------- */
  var toastTimer;
  function toast(msg) {
    var t = document.querySelector(".toast");
    if (!t) { t = document.createElement("div"); t.className = "toast"; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 1900);
  }

  function sheet(id) {
    closeSheets();
    $("overlay").classList.add("show");
    $(id).classList.add("show");
  }
  function closeSheets() {
    $("overlay").classList.remove("show");
    ["sheetMode", "sheetModel", "sheetSettings", "sheetLogin"].forEach(function (i) {
      var el = $(i); if (el) el.classList.remove("show");
    });
  }
  $("overlay").addEventListener("click", closeSheets);

  function scrollBottom() {
    var l = $("msglist");
    requestAnimationFrame(function () { l.scrollTop = l.scrollHeight + 200; });
  }

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function md(text) {
    var s = esc(text || "");
    s = s.replace(/```([a-zA-Z0-9+#-]*)\n?([\s\S]*?)```/g, function (_, lang, code) {
      return "<pre>" + code.replace(/\n$/, "") + "</pre>";
    });
    s = s.replace(/`([^`\n]+)`/g, "<code>$1</code>");
    s = s.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
    s = s.replace(/\n/g, "<br>");
    return s;
  }

  function nowTime() {
    var d = new Date();
    return (d.getHours() < 10 ? "0" : "") + d.getHours() + ":" +
           (d.getMinutes() < 10 ? "0" : "") + d.getMinutes();
  }

  function dayOf(ts) {
    var d = new Date(ts), n = new Date();
    var same = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
    if (same) return "今天";
    var diff = Math.floor((n - d) / 86400000);
    if (diff === 1) return "昨天";
    if (diff < 7) return diff + " 天前";
    return (d.getMonth() + 1) + "月" + d.getDate() + "日";
  }

  /* ---------------- 页面切换 ---------------- */
  function goHome() {
    $("chat").classList.remove("active");
    $("history").classList.remove("active");
    state.current = null;
  }
  function openChat(conv) {
    state.current = conv;
    renderChat();
    $("chat").classList.add("active");
    $("history").classList.remove("active");
    scrollBottom();
  }

  window.__onBack = function () {
    if ($("overlay").classList.contains("show")) { closeSheets(); return true; }
    if ($("chat").classList.contains("active") || $("history").classList.contains("active")) {
      goHome(); return true;
    }
    return false;
  };

  /* ---------------- 对话渲染 ---------------- */
  function updateHeader() {
    $("chatTitle").textContent = state.current ? state.current.title : "新对话";
    $("chatSub").textContent = modelName(state.model) + " · " +
      (state.mode === "advanced" ? "高级" : "标准");
  }

  function emptyChat() {
    var el = document.createElement("div");
    el.className = "empty";
    el.style.paddingTop = "46px";
    el.innerHTML = '<img src="img/ic_wukong.png"><div>有什么可以帮你的？<br>说说你的工作，我来给方案。</div>';
    $("msglist").appendChild(el);
  }

  function renderChat() {
    var list = $("msglist");
    list.innerHTML = "";
    updateHeader();
    if (!state.current || !state.current.messages.length) { emptyChat(); return; }
    state.current.messages.forEach(function (m) { list.appendChild(msgNode(m)); });
  }

  function msgNode(m, opts) {
    opts = opts || {};
    var row = document.createElement("div");
    row.className = "row " + (m.role === "user" ? "user" : "ai");
    var av = document.createElement("div");
    av.className = "avatar " + (m.role === "user" ? "me" : "ai");
    if (m.role === "user") av.textContent = "我";
    else av.innerHTML = '<img src="img/ai_avatar.png">';
    var wrap = document.createElement("div");
    wrap.style.maxWidth = "76%";
    var bubble = document.createElement("div");
    bubble.className = "bubble " + (m.role === "user" ? "user" : "ai");
    if (m.image && m.role === "user") {
      var im = document.createElement("img");
      im.className = "shot"; im.src = m.image;
      bubble.appendChild(im);
    }
    var txt = document.createElement("div");
    txt.className = "txt";
    if (m.role === "assistant" && !m.content && opts.typing) {
      txt.innerHTML = '<span class="dots"><i></i><i></i><i></i></span>';
    } else {
      txt.innerHTML = md(m.content);
    }
    bubble.appendChild(txt);
    var meta = document.createElement("div");
    meta.className = "msg-meta";
    if (m.role === "user") meta.textContent = "你 · " + (m.ts ? timeOf(m.ts) : nowTime());
    else meta.textContent = "悟空" + (m.ts ? " · " + timeOf(m.ts) : "");
    wrap.appendChild(bubble);
    wrap.appendChild(meta);
    row.appendChild(av);
    row.appendChild(wrap);
    row.__txt = txt;
    return row;
  }
  function timeOf(ts) {
    var d = new Date(ts);
    return (d.getHours() < 10 ? "0" : "") + d.getHours() + ":" + (d.getMinutes() < 10 ? "0" : "") + d.getMinutes();
  }

  function newConv(firstText) {
    var c = {
      id: "c" + Date.now().toString(36),
      title: (firstText || "新对话").slice(0, 18),
      createdAt: Date.now(), updatedAt: Date.now(), messages: []
    };
    state.convs.unshift(c);
    return c;
  }

  /* ---------------- 发送 ---------------- */
  function setStreamUI(on) {
    var b = $("btnSend2");
    if (on) { b.classList.add("stop"); b.disabled = false; }
    else { b.classList.remove("stop"); b.disabled = false; }
  }

  function send(text) {
    text = (text || "").trim();
    if (!text && !state.pendingImage) { toast("说点什么再发送吧"); return; }
    if (state.streaming) { stopStream(); return; }

    if (!state.current) {
      var c = newConv(text || "解读这张图片");
      state.current = c;
      openChat(c);
    }
    $("msglist").querySelectorAll(".empty").forEach(function (e) { e.remove(); });

    var userMsg = { role: "user", content: text, image: state.pendingImage || "", ts: Date.now() };
    state.current.messages.push(userMsg);
    state.current.updatedAt = Date.now();
    if (state.current.messages.length === 1) state.current.title = (text || "图片解读").slice(0, 18);
    $("msglist").appendChild(msgNode(userMsg));
    updateHeader();

    var image = state.pendingImage;
    clearAttach();
    $("chatInput").value = "";
    autoGrow($("chatInput"));

    var aiMsg = { role: "assistant", content: "", ts: 0 };
    state.current.messages.push(aiMsg);
    var node = msgNode(aiMsg, { typing: true });
    $("msglist").appendChild(node);
    scrollBottom();
    setStreamUI(true);

    var streamId = "s" + Date.now().toString(36);
    state.streaming = { id: streamId, msg: aiMsg, node: node, buf: "" };
    save();

    if (HOST && HOST.chat) {
      var history = state.current.messages.slice(0, -1).map(function (m) {
        return { role: m.role, content: m.content };
      });
      HOST.chat(JSON.stringify({
        id: streamId, model: state.model,
        mode: state.mode, messages: history,
        image: image || "", imageNote: state.pendingImageNote || ""
      }));
    } else {
      demoStream(text || "请解读这张图片", image);
    }
  }

  function stopStream() {
    if (!state.streaming) return;
    var s = state.streaming;
    if (HOST && HOST.chat) HOST.stopChat(s.id);
    finalize(s.buf ? s.buf : "已停止生成。");
  }

  /* ---------------- 原生流式回调 ---------------- */
  var demoSeq = 0;

  window.__aiDelta = function (id, piece) {
    var s = state.streaming;
    if (!s || s.id !== id) return;
    s.buf += piece;
    paintStream(s);
  };
  window.__aiWait = function (id, sec) {
    var s = state.streaming;
    if (!s || s.id !== id) return;
    var secs = parseInt(sec, 10) || 0;
    if (secs > 0) {
      $("chatSub").textContent = "免费通道排队中 · 约 " + secs + " 秒";
      if (s.node.__txt) {
        s.node.__txt.innerHTML = '<span class="dots"><i></i><i></i><i></i></span>' +
          '<span style="font-size:12px;color:#98a0a9;margin-left:8px">免费额度排队约 ' + secs + ' 秒…</span>';
      }
    } else {
      updateHeader();
    }
  };

  window.__aiDone = function (id) {
    var s = state.streaming;
    if (!s || s.id !== id) return;
    finalize(s.buf || "（没有返回内容）");
  };
  window.__aiStopped = function (id) {
    var s = state.streaming;
    if (!s || s.id !== id) return;
    finalize(s.buf || "已停止生成。");
  };
  window.__aiError = function (id, msg) {
    var s = state.streaming;
    if (!s || s.id !== id) return;
    state.streaming = null;
    setStreamUI(false);
    if (s.node.__txt) {
      s.node.__txt.innerHTML = md("⚠️ " + msg);
    }
    s.node.style.opacity = "1";
    state.current.messages[state.current.messages.length - 1].content = "⚠️ " + msg;
    state.current.messages[state.current.messages.length - 1].ts = Date.now();
    $("btnSend2").disabled = false;
    save();
    scrollBottom();
  };

  function paintStream(s) {
    if (s.node.__txt) s.node.__txt.innerHTML = md(s.buf);
    scrollBottom();
  }

  function finalize(text) {
    var s = state.streaming;
    state.streaming = null;
    setStreamUI(false);
    if (!s) return;
    if (s.node.__txt) s.node.__txt.innerHTML = md(text);
    s.msg.content = text;
    s.msg.ts = Date.now();
    s.node.style.opacity = "1";
    if (state.current) { state.current.updatedAt = Date.now(); }
    save();
    scrollBottom();
    renderHistoryList();
  }

  /* ---------------- 演示流式（未配置 Token） ---------------- */
  function demoStream(text, image) {
    var answer = demoAnswer(text, !!image);
    var i = 0, id = state.streaming.id;
    var timer = setInterval(function () {
      if (!state.streaming || state.streaming.id !== id) { clearInterval(timer); return; }
      var step = 2 + Math.floor(Math.random() * 3);
      var chunk = answer.slice(i, i + step);
      i += step;
      state.streaming.buf += chunk;
      paintStream(state.streaming);
      if (i >= answer.length) {
        clearInterval(timer);
        setTimeout(function () {
          if (state.streaming && state.streaming.id === id) {
            finalize(state.streaming.buf + (DEMO_FOOT));
          }
        }, 260);
      }
    }, 32);
  }

  var DEMO_FOOT = "\n\n—\n（当前为预览环境，未连接模型）";

  function demoAnswer(q, hasImage) {
    var s = q.toLowerCase();
    if (hasImage) {
      return "我先看清这张图的关键信息：\n\n" +
        "1. **主体**：画面里有一个明确的视觉主体，构图居中、留白较足，属于典型的展示型排版。\n" +
        "2. **信息层级**：标题最大、副标题次之、底部说明最小，层级清楚，视线是从上往下走的。\n" +
        "3. **色彩**：主色不超过三支，背景偏浅，主体靠对比度跳出来，整体偏「干净、专业」。\n\n" +
        "**可以怎么用**\n" +
        "- 如果要做成同类物料的模板，建议固定：主标题 1 行、副标题 1 行、底部 2 个小标签。\n" +
        "- 配色直接沿用这套主色 + 一个强调色，避免再加第四种颜色。\n\n" +
        "需要我把它转成可编辑的设计稿结构（标题 / 图 / 色板）吗？告诉我用途，我按尺寸给你出方案。";
    }
    if (/设计|海报|配色|logo|视觉|排版|banner/i.test(s)) {
      return "给你一套能直接落地的设计思路：\n\n" +
        "**1. 先定信息顺序**\n主标题 → 一句价值主张 → 行动入口。三块信息之外的东西都往后放。\n\n" +
        "**2. 配色只用三支**\n主色（品牌色）+ 中性底色 + 一个强调色（只用在按钮和关键数字上）。\n\n" +
        "**3. 版式留白**\n左右至少留 8% 安全边，主体占比 60%~70%，视觉重心偏上 1/3 处。\n\n" +
        "**4. 字体**\n标题一支粗体、正文一支常规体，字号比控制在 2.2:1 左右，中文行高 1.5~1.6。\n\n" +
        "把用途（海报 / 封面 / 详情页）和尺寸发我，我可以按这套规则给你逐屏拆稿。";
    }
    if (/财务|预算|报表|成本|利润|Excel|表格|数据/i.test(s)) {
      return "按财务口径先给你搭骨架：\n\n" +
        "**结构建议**\n- 收入：按产品线 / 渠道拆分，月度同比 + 环比两列\n- 成本：固定成本、变动成本分开，再算边际贡献\n- 结果：毛利率、净利率、费用率三条曲线看趋势\n\n" +
        "**三步动作**\n1. 先把原始流水按「科目 + 月份」拉成宽表；\n2. 用公式算同比、环比，别手填；\n3. 图表只用柱状（金额）+ 折线（比率），一张图不超过两个指标。\n\n" +
        "你把表格发我或说清字段，我可以直接给你生成可导入 Excel 的公式结构和图表配置。";
    }
    if (/代码|报错|bug|程序|接口|api|python|java|js/i.test(s)) {
      return "把问题拆成三步来定位：\n\n" +
        "1. **复现**：最小可复现输入是什么，稳定复现吗？\n" +
        "2. **边界**：报错出现在调用前、调用中还是返回后，日志到哪一层断的？\n" +
        "3. **假设**：先怀疑输入与状态，再怀疑并发与网络，最后才是依赖版本。\n\n" +
        "**通用修法**\n- 关键路径加结构化日志（带 requestId）\n- 超时 / 重试 / 幂等三件套补齐\n- 错误码映射成业务语义，别把异常直接抛给用户\n\n" +
        "把报错栈和关键代码贴给我，我按这个顺序帮你缩到具体那一行。";
    }
    if (/文案|写|总结|润色|邮件|汇报|ppt|方案/i.test(s)) {
      return "先给结论式结构，再补细节：\n\n" +
        "**一句话结论**：把最想让对方记住的那件事放第一句。\n" +
        "**三条支撑**：每条形如「现象 → 原因 → 影响」，一条不超过 40 字。\n" +
        "**下一步**：写清楚你要对方做什么、什么时候做。\n\n" +
        "按这个骨架写，读的人 10 秒内能抓到重点。你把原始素材发我，我按这个结构直接成稿。";
    }
    if (/你好|hi|hello|在吗|你是谁/i.test(s)) {
      return "我是悟空，钉钉生态里的 AI 工作助手。\n\n" +
        "我可以帮你：写方案与文案、做数据分析与财务测算、解读图片和文档、拆解设计与研发问题、把一段混乱的信息整理成结构。\n\n" +
        "直接说你要做的事，或者把素材发我，我来出结果。";
    }
    return "我理解你的需求是：**" + (q.length > 40 ? q.slice(0, 40) + "…" : q) + "**\n\n" +
      "可以按这个路径推进：\n\n" +
      "1. **先对齐目标**：最终交付物是什么，谁来看，看完要做什么决定。\n" +
      "2. **再拆步骤**：拆成 3~5 个可独立验收的动作，每个动作有明确产出。\n" +
      "3. **补风险**：哪一步依赖别人的输入、哪一步最容易返工，提前留缓冲。\n\n" +
      "如果你把更具体的背景（对象、时间、已有素材）发我，我可以直接给出可执行的清单和成稿。";
  }

  /* ---------------- 附件 ---------------- */
  function clearAttach() {
    state.pendingImage = null;
    state.pendingImageNote = "";
    $("attachPreview").style.display = "none";
    $("attachPreview2").style.display = "none";
  }
  function analyzeImage(dataUrl, cb) {
    try {
      var im = new Image();
      im.onload = function () {
        try {
          var n = 40, c = document.createElement("canvas");
          c.width = n; c.height = n;
          var ctx = c.getContext("2d");
          ctx.drawImage(im, 0, 0, n, n);
          var px = ctx.getImageData(0, 0, n, n).data;
          var buckets = {}, sum = 0, cnt = 0;
          for (var i = 0; i < px.length; i += 4) {
            var r = px[i], g = px[i + 1], b = px[i + 2], a = px[i + 3];
            if (a < 40) continue;
            sum += (0.299 * r + 0.587 * g + 0.114 * b);
            cnt++;
            var key = (Math.round(r / 48) << 8) | (Math.round(g / 48) << 4) | Math.round(b / 48);
            if (!buckets[key]) buckets[key] = { n: 0, r: 0, g: 0, b: 0 };
            var bk = buckets[key];
            bk.n++; bk.r += r; bk.g += g; bk.b += b;
          }
          var arr = [];
          for (var k in buckets) arr.push(buckets[k]);
          arr.sort(function (x, y) { return y.n - x.n; });
          var top = arr.slice(0, 4).map(function (bk) {
            var r = Math.round(bk.r / bk.n), g = Math.round(bk.g / bk.n), b = Math.round(bk.b / bk.n);
            var hex = "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
            return hex + "(" + Math.round(bk.n / cnt * 100) + "%)";
          });
          var w = im.naturalWidth, h = im.naturalHeight;
          var ratio = w / h;
          var shape = ratio > 1.35 ? "横图" : (ratio < 0.74 ? "竖图" : "方图");
          var bright = Math.round(sum / Math.max(cnt, 1) / 255 * 100);
          cb("尺寸 " + w + "×" + h + "（" + shape + "，比例 " + ratio.toFixed(2) + "）；平均亮度 " + bright + "%；主要用色 " + top.join("、") + "。");
        } catch (e) { cb(""); }
      };
      im.onerror = function () { cb(""); };
      im.src = dataUrl;
    } catch (e) { cb(""); }
  }

  window.__onImagePicked = function (dataUrl) {
    state.pendingImage = dataUrl;
    state.pendingImageNote = "";
    analyzeImage(dataUrl, function (note) { state.pendingImageNote = note; });
    var p = state.imageTarget === "chat" ? $("attachPreview2") : $("attachPreview");
    var im = state.imageTarget === "chat" ? $("attachThumb2") : $("attachThumb");
    im.src = dataUrl;
    p.style.display = "block";
    if (state.imageTarget === "chat") { $("chatInput").focus(); }
  };
  window.__onImageCancel = function () { toast("已取消选择图片"); };

  /* ---------------- 历史 ---------------- */
  function renderHistoryList() {
    var body = $("histBody");
    if (!state.user) { body.innerHTML = loginWallHtml(); return; }
    if (!state.convs.length) {
      body.innerHTML = '<div class="empty"><img src="img/ic_wukong.png"><div>还没有对话<br>去和悟空聊点什么吧</div></div>';
      return;
    }
    body.innerHTML = "";
    state.convs.forEach(function (c) {
      var item = document.createElement("div");
      item.className = "hist-item";
      var last = "";
      for (var i = c.messages.length - 1; i >= 0; i--) {
        if (c.messages[i].content) { last = c.messages[i].content; break; }
      }
      var preview = String(last).replace(/```[\s\S]*?```/g, " ").replace(/[#*`>_\n]/g, " ").replace(/\s+/g, " ").trim();
      item.innerHTML =
        '<div class="hist-ic"><img src="img/ic_wukong.png"></div>' +
        '<div class="hist-txt"><b>' + esc(c.title) + "</b><p>" + esc(preview.slice(0, 60)) + "</p></div>" +
        '<div class="hist-date">' + dayOf(c.updatedAt) + "</div>";
      item.addEventListener("click", function () { openConvFromHistory(c.id); });
      body.appendChild(item);
    });
  }

  function loginWallHtml() {
    return '<div class="empty"><img src="img/ic_wukong.png">' +
      "<div>登录后即可查看全部对话历史<br>并与多端同步</div>" +
      '<button class="primary-btn" id="btnLoginWall" style="margin-top:18px">立即登录</button></div>';
  }

  function openHistory() {
    if (!state.user) {
      state.loginCb = function () { renderHistoryList(); };
      sheet("sheetLogin");
      setTimeout(function () { $("qrImg").src = ""; }, 0);
      return;
    }
    renderHistoryList();
    $("history").classList.add("active");
  }

  function openConvFromHistory(id) {
    if (!state.user) { toast("请先登录"); sheet("sheetLogin"); return; }
    var c = state.convs.filter(function (x) { return x.id === id; })[0];
    if (!c) return;
    openChat(c);
  }

  /* ---------------- 登录 ---------------- */
  function switchTab(tab) {
    document.querySelectorAll(".login-tabs .tab").forEach(function (b) {
      b.classList.toggle("active", b.dataset.tab === tab);
    });
    $("paneEmail").classList.toggle("hidden", tab !== "email");
    $("panePhone").classList.toggle("hidden", tab !== "phone");
    $("paneQr").classList.toggle("hidden", tab !== "qr");
    if (tab === "qr") refreshQr();
  }

  function refreshQr() {
    var code = "WK" + Math.random().toString(36).slice(2, 8).toUpperCase();
    var link = "https://login.dingtalk.com/oauth2/auth?response_type=code&client_id=dingtalk-wukong-ai" +
      "&scope=openid&prompt=consent&state=" + code +
      "&redirect_uri=https%3A%2F%2Fwukong.ai%2Fauth%2Fdingtalk";
    var img = $("qrImg");
    $("qrMask").classList.remove("show");
    $("qrStatus").classList.remove("ok");
    $("qrStatus").textContent = "打开钉钉 App 扫一扫，在手机上确认登录";
    if (HOST && HOST.makeQr) {
      var url = HOST.makeQr(link, 420);
      if (url) { img.src = url; return; }
    }
    img.src = "img/qr_fallback.svg";
  }

  function loginDone(kind, account) {
    var name = account || "悟空用户";
    if (kind === "phone") name = account.slice(0, 3) + "****" + account.slice(7);
    if (kind === "email") name = account;
    if (kind === "dingtalk") name = "钉钉用户 " + String(account).slice(0, 4);
    state.user = { kind: kind, account: account, name: name, ts: Date.now() };
    save();
    closeSheets();
    renderUserChip();
    toast("登录成功");
    if (state.loginCb) { var cb = state.loginCb; state.loginCb = null; cb(); }
    $("history").classList.add("active");
  }

  function renderUserChip() {
    if (!state.user) {
      $("userChip").innerHTML = '<span style="color:#a2a8b1">未登录</span>';
      return;
    }
    $("userChip").innerHTML = '<div class="av">' + esc(state.user.name.slice(0, 1)) + "</div><span>" + esc(state.user.name) + "</span>";
  }

  /* ---------------- 输入框自适应 ---------------- */
  function autoGrow(el) {
    el.style.height = "auto";
    var h = Math.min(el.scrollHeight, 110);
    el.style.height = (el === $("homeInput") ? 62 : Math.max(38, h)) + "px";
  }

  function bindInput(input, btn) {
    input.addEventListener("input", function () {
      autoGrow(input);
      if (input === $("homeInput")) {
        btn.classList.toggle("ready", input.value.trim().length > 0 || !!state.pendingImage);
      }
    });
  }

  /* ---------------- 事件绑定 ---------------- */
  var booted = false;
  function boot() {
    if (booted) return;
    booted = true;
    load();
    renderUserChip();
    updateHeader();

    bindInput($("homeInput"), $("btnSend"));
    bindInput($("chatInput"), $("btnSend2"));

    $("btnSend").addEventListener("click", function () { send($("homeInput").value); $("homeInput").value = ""; autoGrow($("homeInput")); $("btnSend").classList.remove("ready"); });
    $("btnSend2").addEventListener("click", function () {
      if (state.streaming) { stopStream(); return; }
      send($("chatInput").value);
    });

    $("btnNewTop").addEventListener("click", function () { goHome(); toast("新对话已就绪"); });
    $("btnHistory").addEventListener("click", openHistory);
    $("btnHistory2").addEventListener("click", openHistory);
    $("btnBack").addEventListener("click", goHome);
    $("btnBack2").addEventListener("click", goHome);
    $("btnNew2").addEventListener("click", function () { goHome(); toast("新对话已就绪"); });

    // 图片解读
    function pick(target) {
      state.imageTarget = target;
      if (HOST && HOST.pickImage) HOST.pickImage();
      else toast("当前环境不支持选择图片");
    }
    $("btnImage").addEventListener("click", function () { pick("home"); });
    $("btnImage2").addEventListener("click", function () { pick("chat"); });
    $("attachRemove").addEventListener("click", clearAttach);
    $("attachRemove2").addEventListener("click", clearAttach);

    // 模式
    $("btnMode").addEventListener("click", function () { markMode(); sheet("sheetMode"); });
    document.querySelectorAll("#sheetMode .opt-card").forEach(function (card) {
      card.addEventListener("click", function () {
        state.mode = card.dataset.mode;
        save(); markMode(); updateHeader(); closeSheets();
        toast(state.mode === "advanced" ? "已切换为高级模式" : "已切换为标准模式");
      });
    });

    // 模型
    $("btnModel").addEventListener("click", function () { renderModels(); sheet("sheetModel"); });
    $("btnCustomModel").addEventListener("click", function () {
      var v = $("customModel").value.trim();
      if (!v) return;
      state.model = v; save(); updateHeader(); renderModels(); closeSheets();
      toast("已切换模型：" + modelName(v));
    });

    // 登录
    document.querySelectorAll(".login-tabs .tab").forEach(function (t) {
      t.addEventListener("click", function () { switchTab(t.dataset.tab); });
    });
    $("btnEmailLogin").addEventListener("click", function () {
      var v = $("loginEmail").value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { toast("请输入正确的邮箱地址"); return; }
      loginDone("email", v);
    });
    $("btnPhoneLogin").addEventListener("click", function () {
      var p = $("loginPhone").value.trim(), c = $("loginCode").value.trim();
      if (!/^1\d{10}$/.test(p)) { toast("请输入 11 位手机号"); return; }
      if (c.length !== 6) { toast("请输入 6 位验证码"); return; }
      loginDone("phone", p);
    });
    var codeTimer = null;
    $("btnSendCode").addEventListener("click", function () {
      var p = $("loginPhone").value.trim();
      if (!/^1\d{10}$/.test(p)) { toast("请输入 11 位手机号"); return; }
      var btn = $("btnSendCode"), n = 60;
      btn.disabled = true; btn.textContent = n + "s 后重发";
      $("loginCode").value = "8" + Math.floor(10000 + Math.random() * 89999);
      toast("验证码已发送（演示已自动填入）");
      codeTimer = setInterval(function () {
        n--;
        if (n <= 0) { clearInterval(codeTimer); btn.disabled = false; btn.textContent = "获取验证码"; }
        else btn.textContent = n + "s 后重发";
      }, 1000);
    });
    $("btnQrRefresh").addEventListener("click", refreshQr);
    $("btnQrSim").addEventListener("click", function () {
      $("qrStatus").textContent = "已扫码，正在登录…";
      setTimeout(function () {
        $("qrStatus").classList.add("ok");
        $("qrStatus").textContent = "扫码成功，正在进入…";
        setTimeout(function () { loginDone("dingtalk", "K" + Math.random().toString(36).slice(2, 6).toUpperCase()); }, 900);
      }, 900);
    });

    // 历史墙上的登录按钮（事件委托）
    $("histBody").addEventListener("click", function (e) {
      if (e.target && e.target.id === "btnLoginWall") { sheet("sheetLogin"); }
    });

    // 精选案例：只做预览
    document.querySelectorAll(".case").forEach(function (c) {
      c.addEventListener("click", function () { toast("「" + c.dataset.case + "」案例为预览内容"); });
    });
    $("btnMore").addEventListener("click", function () { toast("查看更多案例即将上线"); });

    // 退出登录
    $("userChip").addEventListener("click", function () {
      if (!state.user) { sheet("sheetLogin"); return; }
      if (window.confirm("退出当前账号？")) {
        state.user = null; save(); renderUserChip(); renderHistoryList(); toast("已退出登录");
      }
    });

    switchTab("email");
    markMode();
  }

  function markMode() {
    $("btnMode").firstChild.textContent = state.mode === "advanced" ? "高级" : "标准";
    document.querySelectorAll("#sheetMode .opt-card").forEach(function (c) {
      c.classList.toggle("on", c.dataset.mode === state.mode);
    });
  }

  function renderModels() {
    var box = $("modelList");
    box.innerHTML = "";
    MODELS.forEach(function (m) {
      var row = document.createElement("div");
      row.className = "model-row" + (state.model === m.id ? " on" : "");
      row.innerHTML = '<div class="mt"><b>' + esc(m.name) + "</b><p>" + esc(m.id) + " · " + esc(m.desc) + "</p></div><i class=\"radio\"></i>";
      row.addEventListener("click", function () {
        state.model = m.id; save(); updateHeader(); renderModels(); closeSheets();
        toast("已切换模型：" + m.name);
      });
      box.appendChild(row);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
