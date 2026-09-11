import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUp,
  ArrowUpRight,
  ArrowLeft,
  Check,
  ChevronDown,
  Code2,
  Copy,
  ExternalLink,
  Eye,
  FileCode2,
  FolderOpen,
  HelpCircle,
  History,
  Infinity as Loop,
  Laptop,
  LoaderCircle,
  MessageSquare,
  Monitor,
  Plus,
  RotateCcw,
  SearchCheck,
  Settings2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Square,
  ToggleLeft,
  ToggleRight,
  X,
} from "lucide-react";
import type { State, Task, Feedback, Project } from "../shared/types";
import "./style.css";

type Model = { id: string; provider: string; name: string };
type Data = State & { previewOrigin: string };
async function api<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(
    "/api" + url,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}
const labels: Record<Task["status"], string> = {
  running: "正在执行",
  ready: "候选已就绪",
  failed: "执行未完成",
  cancelled: "已停止",
  interrupted: "已中断",
  adopted: "已采用",
};
const time = (value: string) =>
  new Date(value).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
function App() {
  const [data, setData] = useState<Data>({
    projects: [],
    tasks: [],
    previewOrigin: "http://127.0.0.1:4511",
  });
  const [projectId, setProjectId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [models, setModels] = useState<Model[]>([]);
  const [modelKey, setModelKey] = useState("");
  const [view, setView] = useState<"work" | "feedback">("work");
  const [tab, setTab] = useState<"preview" | "evidence" | "changes">("preview");
  const [version, setVersion] = useState<"current" | "candidate">("current");
  const [mobile, setMobile] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [modal, setModal] = useState<"project" | "help" | "feedback" | null>(
    null,
  );
  const [feedbackText, setFeedbackText] = useState("");
  const [scope, setScope] = useState("index.html");
  const [editing, setEditing] = useState<Feedback | null>(null);
  const [projectPath, setProjectPath] = useState("");
  const [projectName, setProjectName] = useState("");
  const [entry, setEntry] = useState("index.html");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const project =
    data.projects.find((p) => p.id === projectId) || data.projects[0];
  const tasks = data.tasks
    .filter((t) => t.projectId === project?.id)
    .slice()
    .reverse();
  const task = tasks.find((t) => t.id === taskId);
  const running = data.tasks.find((t) => t.status === "running");
  const model = models.find((m) => `${m.provider}/${m.id}` === modelKey);
  const refresh = async () => {
    const d = await api<Data>("/state");
    setData(d);
    setLoaded(true);
  };
  useEffect(() => {
    void refresh().catch((e) => setNotice(e.message));
    void api<{ models: Model[] }>("/models")
      .then((d) => {
        setModels(d.models);
        if (d.models[0])
          setModelKey(`${d.models[0].provider}/${d.models[0].id}`);
      })
      .catch((e) => setNotice(e.message));
    const id = setInterval(() => void refresh().catch(() => {}), 2000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement;
    const container = document.querySelector<HTMLElement>(".modal");
    (
      container?.querySelector<HTMLElement>("input, textarea") ||
      container?.querySelector<HTMLElement>("button")
    )?.focus();
    const listener = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModal(null);
      if (e.key === "Tab" && container) {
        const items = [
          ...container.querySelectorAll<HTMLElement>(
            "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href]",
          ),
        ];
        const first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", listener);
    return () => {
      window.removeEventListener("keydown", listener);
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, [modal]);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const chooseProject = (id: string) => {
    setProjectId(id);
    setTaskId("");
    setVersion("current");
    setTab("preview");
  };
  const openFeedback = (f?: Feedback) => {
    setEditing(f || null);
    setFeedbackText(f?.text || "");
    setScope(f?.scope || project?.entry || "index.html");
    setModal("feedback");
  };
  async function example() {
    await action(async () => {
      const p = await api<Project>("/example", {});
      chooseProject(p.id);
      setModal(null);
    });
  }
  async function submit() {
    if (!project || !prompt.trim() || !model || running || busy) return;
    await action(async () => {
      const t = await api<Task>("/tasks", {
        projectId: project.id,
        prompt,
        provider: model.provider,
        modelId: model.id,
      });
      setTaskId(t.id);
      setPrompt("");
      setVersion("candidate");
      setTab("preview");
    });
  }
  async function checkPage() {
    if (!project) return;
    await action(async () => {
      const t = await api<Task>(`/projects/${project.id}/check`, {});
      setTaskId(t.id);
      setVersion("current");
      setTab("evidence");
    });
  }
  const revision =
    version === "candidate" && task ? task.revision : project?.activeRevision;
  const previewUrl =
    project && revision
      ? `${data.previewOrigin}/p/${project.id}/${revision}/${project.entry.split("/").map(encodeURIComponent).join("/")}`
      : "";
  const feedbackCount = project?.feedback.filter((f) => f.active).length || 0;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="logo" href="/" aria-label="PiLoop 首页">
          <span className="logo-mark">
            <Loop size={29} strokeWidth={2.1} />
          </span>
          <strong>
            PiLoop<span> /</span>
          </strong>
        </a>
        <div className="workspace-label">
          你的工作空间 <span>LOCAL</span>
        </div>
        <button className="project-switch" onClick={() => setModal("project")}>
          <FolderOpen size={17} />
          <span>{project?.name || "连接一个项目"}</span>
          <ChevronDown size={14} />
        </button>
        <nav className="main-nav" aria-label="主导航">
          <button
            className={view === "work" ? "selected" : ""}
            onClick={() => setView("work")}
          >
            <MessageSquare size={17} />
            工作台
            <span className="nav-dot" />
          </button>
          <button
            className={view === "feedback" ? "selected" : ""}
            onClick={() => setView("feedback")}
          >
            <Loop size={18} />
            体验标准<span className="count">{feedbackCount}</span>
          </button>
        </nav>
        <div className="history-label">
          最近任务
          <button
            className="icon-button"
            title="新任务"
            aria-label="新任务"
            onClick={() => {
              setTaskId("");
              setView("work");
              setVersion("current");
              setTab("preview");
            }}
          >
            <Plus size={16} />
          </button>
        </div>
        <div className="history-list">
          {tasks.length === 0 ? (
            <p className="quiet-empty">每一次修改，都会留在这里。</p>
          ) : (
            tasks.slice(0, 20).map((t) => (
              <button
                key={t.id}
                className={
                  task?.id === t.id ? "history-item active" : "history-item"
                }
                onClick={() => {
                  setTaskId(t.id);
                  setView("work");
                  setVersion(
                    t.modelId === "playwright" ? "current" : "candidate",
                  );
                }}
              >
                <span className={`tiny-dot ${t.status}`} />
                <span>{t.prompt}</span>
              </button>
            ))
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="local-note">
            <span className="status-dot" />
            本地工作，持续改进<span>V0.1</span>
          </div>
          <button onClick={() => setModal("help")}>
            <Settings2 size={16} />
            模型与使用说明
            <ArrowUpRight size={14} />
          </button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb">
            工作空间<span>/</span>
            <b>{view === "feedback" ? "体验标准" : "工作台"}</b>
          </div>
          <div className="top-actions">
            <span className="local-badge">
              <ShieldCheck size={13} />
              原项目不被改动
            </span>
            <button
              className="icon-button"
              aria-label="使用说明"
              onClick={() => setModal("help")}
            >
              <HelpCircle size={18} />
            </button>
          </div>
        </header>
        <div className="page-heading">
          <div>
            <div className="eyebrow">A LITTLE BETTER, EVERY LOOP.</div>
            <h1>
              {view === "feedback"
                ? "你的标准，下一次还记得。"
                : task
                  ? "让这次修改，真正落到体验。"
                  : "让下一次，比这一次更好。"}
            </h1>
            <p>
              {view === "feedback"
                ? "来自你的纠正，有范围、有来源，也可以随时修订。"
                : "你给方向，PiLoop 负责修改、检查，把你的反馈带进下一次。"}
            </p>
          </div>
          <span className="version-badge">
            Pi-powered <Loop size={15} />
          </span>
        </div>
        {notice && (
          <div className="notice" role="alert">
            <span>{notice}</span>
            <button
              className="icon-button"
              aria-label="关闭提示"
              onClick={() => setNotice("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {!loaded ? (
          <div className="loading">
            <LoaderCircle className="spin" />
            正在连接本地工作空间…
          </div>
        ) : view === "feedback" ? (
          <section className="standards-panel">
            <div className="panel-heading">
              <div>
                <h2>
                  体验标准 <span>{feedbackCount} 条生效</span>
                </h2>
                <p>V0 按文件或目录匹配范围；不会自动推断所有相似组件。</p>
              </div>
              <button
                className="primary"
                disabled={!project || !!running}
                onClick={() => openFeedback()}
              >
                <Plus size={16} />
                记下一个标准
              </button>
            </div>
            {!project?.feedback.length ? (
              <div className="standards-empty">
                <Loop size={38} />
                <h3>从一次真实的纠正开始</h3>
                <p>
                  例如：“这个页面的菜单点击外部和 Esc 都应该关闭。”
                  <br />
                  保存后，后续读取相关文件时会自动带入。
                </p>
                <button
                  className="secondary"
                  disabled={!project}
                  onClick={() => openFeedback()}
                >
                  添加第一条反馈
                </button>
              </div>
            ) : (
              <div className="feedback-list">
                {project.feedback
                  .slice()
                  .reverse()
                  .map((f) => (
                    <article
                      className={`feedback-card ${!f.active ? "inactive" : ""}`}
                      key={f.id}
                    >
                      <div className="feedback-top">
                        <span className="scope-tag">
                          <FileCode2 size={12} />
                          {f.scope === "*" ? "整个项目" : f.scope}
                        </span>
                        <span>
                          {f.active ? "生效中" : "已停用"} ·{" "}
                          {new Date(f.createdAt).toLocaleDateString("zh-CN")}
                        </span>
                      </div>
                      <p>{f.text}</p>
                      <div className="feedback-bottom">
                        <span>
                          {f.sourceTaskId
                            ? "来源：任务纠正"
                            : "来源：你直接添加"}
                          {f.supersedes ? " · 修订版本" : ""}
                        </span>
                        <button
                          disabled={!!running}
                          onClick={() => openFeedback(f)}
                        >
                          修订
                        </button>
                        <button
                          aria-label={f.active ? "停用标准" : "启用标准"}
                          disabled={!!running}
                          onClick={() =>
                            action(async () => {
                              await api(
                                `/projects/${project.id}/feedback/${f.id}/toggle`,
                                {},
                              );
                            })
                          }
                        >
                          {f.active ? (
                            <ToggleRight size={24} />
                          ) : (
                            <ToggleLeft size={24} />
                          )}
                        </button>
                      </div>
                    </article>
                  ))}
              </div>
            )}
          </section>
        ) : (
          <div className="work-grid">
            <section className="conversation-panel">
              <div className="panel-title">
                <span>
                  <span className="status-dot" />
                  {task ? labels[task.status] : "准备好开始新一轮"}
                </span>
                <span className="subtle">
                  {project ? project.entry : "尚未连接项目"}
                </span>
              </div>
              <div className="conversation-body">
                {!project ? (
                  <div className="welcome">
                    <div className="welcome-symbol">
                      <Loop size={42} />
                    </div>
                    <h2>从一个正在做的项目开始</h2>
                    <p>
                      连接本地静态网页，或先打开示例博客。
                      <br />
                      候选修改保存在独立副本，原文件保持原样。
                    </p>
                    <button
                      className="primary"
                      onClick={example}
                      disabled={busy}
                    >
                      <FolderOpen size={16} />
                      打开示例项目
                      <ArrowUpRight size={15} />
                    </button>
                    <button
                      className="text-button"
                      onClick={() => setModal("project")}
                    >
                      连接我的本地项目
                    </button>
                    <div className="welcome-footer">
                      <span>01 给出修改方向</span>
                      <span>02 检查真实页面</span>
                      <span>03 带着反馈继续</span>
                    </div>
                  </div>
                ) : !task ? (
                  <div className="start-state">
                    <span className="small-label">READY WHEN YOU ARE</span>
                    <h2>今天，想让哪里更好？</h2>
                    <p>
                      描述你想要的变化，不必先找文件。
                      <br />
                      相关代码和适用反馈，交给 PiLoop。
                    </p>
                    <div className="suggestions">
                      {[
                        "让探索菜单支持点击外部和 Esc 关闭，保留原来的视觉风格。",
                        "检查窄屏阅读体验，修复拥挤和溢出，保留内容与字体。",
                        "让知识卡展开更平滑，同时尊重减少动态效果的系统设置。",
                      ].map((s, i) => (
                        <button key={s} onClick={() => setPrompt(s)}>
                          <span>{["交互细节", "阅读体验", "动效一致"][i]}</span>
                          {s}
                          <ArrowUpRight size={14} />
                        </button>
                      ))}
                    </div>
                    <div className="feedback-hint">
                      <Loop size={17} />
                      <span>
                        {feedbackCount
                          ? `${feedbackCount} 条项目标准已就绪，相关文件读取时会带入。`
                          : "还没有体验标准。一次纠正，就是下一次的起点。"}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="task-content">
                    <div className="request-label">
                      你的方向 <span>{time(task.createdAt)}</span>
                    </div>
                    <div className="user-request">{task.prompt}</div>
                    <div className="agent-label">
                      <span className="mini-logo">
                        <Loop size={15} />
                      </span>
                      PiLoop
                      <span>
                        {task.modelId === "playwright"
                          ? "浏览器检查 · 未调用模型"
                          : task.modelId}
                      </span>
                    </div>
                    {task.recalled.length > 0 && (
                      <details className="recalled">
                        <summary>
                          <Loop size={14} />
                          带入了 {task.recalled.length} 条适用反馈
                        </summary>
                        {task.recalled.map((f) => (
                          <p key={f.id}>
                            <b>{f.scope}</b> {f.text}
                          </p>
                        ))}
                      </details>
                    )}
                    <div className="activity-list">
                      {task.events
                        .filter((e) => e.kind !== "message")
                        .slice(-8)
                        .map((e, i) => (
                          <div key={i}>
                            <span
                              className={
                                e.kind === "warning"
                                  ? "warning-dot"
                                  : "activity-dot"
                              }
                            />
                            <span>
                              {(
                                {
                                  project_list: "查看项目文件",
                                  project_read: "读取代码与适用反馈",
                                  project_edit: "修改候选副本",
                                  project_create: "创建项目文件",
                                  browser_check: "在真实浏览器中检查",
                                } as Record<string, string>
                              )[e.text] || e.text}
                            </span>
                          </div>
                        ))}
                    </div>
                    {task.status === "running" && (
                      <div className="working">
                        <LoaderCircle size={15} className="spin" />
                        正在处理，你可以继续查看当前版本。
                      </div>
                    )}
                    {task.result && (
                      <div className="agent-result">{task.result}</div>
                    )}
                    {task.error && (
                      <div className="task-error">{task.error}</div>
                    )}
                    {task.status !== "running" && (
                      <div className="result-actions">
                        <button
                          className="secondary"
                          onClick={() => setTab("evidence")}
                        >
                          <SearchCheck size={15} />
                          查看检查证据
                        </button>
                        <button
                          className="text-button"
                          onClick={() => openFeedback()}
                        >
                          <Plus size={14} />
                          纠正并记住
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="composer-area">
                {project && !models.length && (
                  <div className="model-warning">
                    尚未配置模型。可先检查页面、保存反馈。
                    <button onClick={() => setModal("help")}>配置说明 ↗</button>
                  </div>
                )}
                <form
                  className="composer"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submit();
                  }}
                >
                  <textarea
                    aria-label="描述你想修改的内容"
                    placeholder={
                      project
                        ? "描述这一次想改进的地方…"
                        : "先连接项目，再开始你的第一轮修改…"
                    }
                    value={prompt}
                    disabled={!project}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                        e.preventDefault();
                        void submit();
                      }
                    }}
                  />
                  <div className="composer-toolbar">
                    <div>
                      <Code2 size={14} />
                      <select
                        aria-label="选择模型"
                        value={modelKey}
                        onChange={(e) => setModelKey(e.target.value)}
                        disabled={!models.length || !!running}
                      >
                        {!models.length && <option>配置 Pi 模型后开始</option>}
                        {models.map((m) => (
                          <option
                            key={`${m.provider}/${m.id}`}
                            value={`${m.provider}/${m.id}`}
                          >
                            {m.name} · {m.provider}
                          </option>
                        ))}
                      </select>
                    </div>
                    {running ? (
                      <button
                        className="send-button stop"
                        type="button"
                        title="停止当前任务"
                        onClick={() =>
                          action(async () => {
                            await api(`/tasks/${running.id}/cancel`, {});
                          })
                        }
                      >
                        <Square size={14} />
                      </button>
                    ) : (
                      <button
                        className="send-button"
                        type="submit"
                        aria-label="开始修改"
                        disabled={!project || !model || !prompt.trim() || busy}
                      >
                        <ArrowUp size={19} />
                      </button>
                    )}
                  </div>
                </form>
                <div className="composer-footnote">
                  <ShieldCheck size={12} />
                  仅修改本地候选副本<span>Ctrl ↵ 发送</span>
                </div>
              </div>
            </section>

            <section className="preview-panel">
              <div className="preview-tabs">
                <div>
                  {(
                    [
                      ["preview", "页面预览"],
                      ["evidence", "检查证据"],
                      ["changes", "代码变化"],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      className={tab === key ? "active" : ""}
                      onClick={() => setTab(key)}
                    >
                      {label}
                      {key === "evidence" && !!task?.evidence.length && (
                        <span>{task.evidence.length}</span>
                      )}
                      {key === "changes" && !!task?.changes.length && (
                        <span>{task.changes.length}</span>
                      )}
                    </button>
                  ))}
                </div>
                <button
                  className="icon-button"
                  title="在新窗口打开预览"
                  aria-label="在新窗口打开预览"
                  disabled={!project}
                  onClick={() =>
                    window.open(previewUrl, "_blank", "noopener,noreferrer")
                  }
                >
                  <ExternalLink size={15} />
                </button>
              </div>
              {tab === "preview" ? (
                <>
                  <div className="preview-toolbar">
                    <div className="segmented">
                      <button
                        className={version === "current" ? "active" : ""}
                        onClick={() => setVersion("current")}
                      >
                        当前版本
                      </button>
                      <button
                        disabled={!task || task.modelId === "playwright"}
                        className={version === "candidate" ? "active" : ""}
                        onClick={() => setVersion("candidate")}
                      >
                        候选版本
                      </button>
                    </div>
                    <div className="device-buttons">
                      <button
                        className={
                          !mobile ? "active icon-button" : "icon-button"
                        }
                        aria-label="桌面预览"
                        onClick={() => setMobile(false)}
                      >
                        <Monitor size={16} />
                      </button>
                      <button
                        className={
                          mobile ? "active icon-button" : "icon-button"
                        }
                        aria-label="手机预览"
                        onClick={() => setMobile(true)}
                      >
                        <Smartphone size={16} />
                      </button>
                    </div>
                  </div>
                  <div className={`preview-canvas ${mobile ? "mobile" : ""}`}>
                    {project ? (
                      <iframe
                        key={previewUrl}
                        title="项目页面预览"
                        src={previewUrl}
                        sandbox="allow-scripts"
                      />
                    ) : (
                      <div className="preview-placeholder">
                        <div className="mock-browser">
                          <div>
                            <i />
                            <i />
                            <i />
                          </div>
                          <div className="mock-line short" />
                          <div className="mock-line" />
                          <div className="mock-line medium" />
                          <div className="mock-blocks">
                            <span />
                            <span />
                          </div>
                        </div>
                        <h3>真实的页面，真实的变化。</h3>
                        <p>连接项目后，在这里预览与比较。</p>
                      </div>
                    )}
                  </div>
                  <div className="preview-footer">
                    <span>
                      <span className="status-dot" />
                      {version === "candidate" && task
                        ? "候选预览 · 不代表已充分验证"
                        : "当前工作副本"}
                    </span>
                    {task?.status === "ready" && task.changes.length > 0 ? (
                      <button
                        className="primary small"
                        disabled={busy || !!running}
                        onClick={() =>
                          action(async () => {
                            await api(`/tasks/${task.id}/adopt`, {});
                            setVersion("current");
                          })
                        }
                      >
                        <Check size={14} />
                        采用候选
                      </button>
                    ) : task?.status === "adopted" &&
                      project?.activeRevision === task.revision ? (
                      <button
                        className="text-button"
                        disabled={busy || !!running}
                        onClick={() =>
                          action(async () => {
                            await api(`/tasks/${task.id}/restore`, {});
                          })
                        }
                      >
                        <RotateCcw size={13} />
                        撤回采用
                      </button>
                    ) : (
                      <button
                        className="text-button"
                        disabled={!project || busy || !!running}
                        onClick={checkPage}
                      >
                        <SearchCheck size={14} />
                        检查页面
                      </button>
                    )}
                  </div>
                </>
              ) : tab === "evidence" ? (
                <div className="evidence-panel">
                  <div className="evidence-intro">
                    <SearchCheck size={19} />
                    <div>
                      <h3>看证据，不只看结论。</h3>
                      <p>
                        截图与断言记录实际检查结果，不代表审美和所有行为都已验收。
                      </p>
                    </div>
                  </div>
                  {!task?.evidence.length ? (
                    <div className="empty-panel">
                      <Eye size={28} />
                      <p>还没有浏览器检查记录</p>
                      <button
                        className="secondary"
                        disabled={!project || !!running || busy}
                        onClick={checkPage}
                      >
                        检查当前页面
                      </button>
                    </div>
                  ) : (
                    task.evidence.map((e) => (
                      <article className="evidence-card" key={e.id}>
                        <div className="evidence-card-title">
                          <span>
                            {e.width < 600 ? (
                              <Smartphone size={15} />
                            ) : (
                              <Monitor size={15} />
                            )}{" "}
                            {e.width} × {e.height}
                          </span>
                          <span>
                            {(e.writeVersion || 0) < (task.writeVersion || 0)
                              ? "历史版本 · "
                              : "当前候选 · "}
                            {time(e.createdAt)}
                          </span>
                        </div>
                        <a href={e.screenshot} target="_blank" rel="noreferrer">
                          <img
                            src={e.screenshot}
                            alt={`${e.title} ${e.width} 像素视口实际检查截图`}
                          />
                        </a>
                        <div className="check-list">
                          {e.checks.map((c, i) => (
                            <div key={i} className={c.passed ? "pass" : "fail"}>
                              {c.passed ? <Check size={13} /> : <X size={13} />}
                              <span>{c.label}</span>
                            </div>
                          ))}
                        </div>
                        {e.consoleErrors.length > 0 && (
                          <pre>{e.consoleErrors.join("\n")}</pre>
                        )}
                      </article>
                    ))
                  )}
                </div>
              ) : (
                <div className="changes-panel">
                  {!task?.changes.length ? (
                    <div className="empty-panel">
                      <FileCode2 size={28} />
                      <p>任务完成后的文件变化会显示在这里。</p>
                    </div>
                  ) : (
                    <>
                      <p className="changes-note">
                        {task.changes.length} 个文件变化 · 每侧最多展示 24,000
                        字符
                      </p>
                      {task.changes.map((c) => (
                        <details className="change-card" key={c.path}>
                          <summary>
                            <FileCode2 size={14} />
                            {c.path}
                            <span>{c.kind}</span>
                          </summary>
                          <h4>修改前</h4>
                          <pre>{c.before || "（无）"}</pre>
                          <h4>修改后</h4>
                          <pre>{c.after || "（无）"}</pre>
                        </details>
                      ))}
                    </>
                  )}
                </div>
              )}
            </section>
          </div>
        )}
        <footer className="page-footer">
          <span>
            <Loop size={13} />
            记住你的标准，而不只是你的对话。
          </span>
          <span>LOCAL FIRST · BUILT ON PI</span>
        </footer>
      </main>

      {modal && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModal(null);
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={
              modal === "project"
                ? "连接项目"
                : modal === "feedback"
                  ? "保存体验标准"
                  : "模型与使用说明"
            }
          >
            <button
              className="modal-close icon-button"
              aria-label="关闭对话框"
              onClick={() => setModal(null)}
            >
              <X size={20} />
            </button>
            {notice && (
              <div className="notice" role="alert">
                {notice}
              </div>
            )}
            {modal === "project" ? (
              <>
                <div className="modal-icon">
                  <FolderOpen size={23} />
                </div>
                <h2>连接你的项目</h2>
                <p>
                  V0 支持本地 HTML / CSS /
                  JavaScript。复制到工作空间后再修改，不改原文件；外部网络资源暂不加载。
                </p>
                {data.projects.length > 0 && (
                  <div className="project-options">
                    {data.projects.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          chooseProject(p.id);
                          setModal(null);
                        }}
                      >
                        <FolderOpen size={15} />
                        {p.name}
                        <ArrowUpRight size={14} />
                      </button>
                    ))}
                  </div>
                )}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void action(async () => {
                      const p = await api<Project>("/projects", {
                        source: projectPath,
                        name: projectName,
                        entry,
                      });
                      chooseProject(p.id);
                      setModal(null);
                    });
                  }}
                >
                  <label>
                    项目名称
                    <input
                      autoFocus
                      required
                      maxLength={80}
                      value={projectName}
                      onChange={(e) => setProjectName(e.target.value)}
                      placeholder="我的 Blog"
                    />
                  </label>
                  <label>
                    本地目录
                    <input
                      required
                      value={projectPath}
                      onChange={(e) => setProjectPath(e.target.value)}
                      placeholder="D:\Projects\my-blog"
                    />
                  </label>
                  <label>
                    HTML 入口
                    <input
                      required
                      value={entry}
                      onChange={(e) => setEntry(e.target.value)}
                    />
                  </label>
                  <button className="primary full" disabled={busy || !!running}>
                    连接并创建工作副本
                  </button>
                </form>
                <button
                  className="text-button full"
                  disabled={busy}
                  onClick={example}
                >
                  先试试内置示例项目 →
                </button>
              </>
            ) : modal === "feedback" ? (
              <>
                <div className="modal-icon">
                  <Loop size={24} />
                </div>
                <h2>{editing ? "修订体验标准" : "这次纠正，下次记得"}</h2>
                <p>
                  保存后会自动用于相关文件的后续修改。不会把你的话自动推广到所有组件。
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!project) return;
                    void action(async () => {
                      await api(`/projects/${project.id}/feedback`, {
                        text: feedbackText,
                        scope,
                        ...(task ? { sourceTaskId: task.id } : {}),
                        ...(editing ? { supersedes: editing.id } : {}),
                      });
                      setModal(null);
                    });
                  }}
                >
                  <label>
                    你的反馈
                    <textarea
                      autoFocus
                      required
                      maxLength={1600}
                      value={feedbackText}
                      onChange={(e) => setFeedbackText(e.target.value)}
                      placeholder="例如：这个页面的菜单点击外部或按 Esc 都应关闭；含未保存内容的编辑弹窗除外。"
                    />
                  </label>
                  <label>
                    适用文件或目录
                    <input
                      required
                      value={scope}
                      onChange={(e) => setScope(e.target.value)}
                      placeholder="index.html"
                    />
                  </label>
                  <p className="field-help">
                    用 * 表示整个项目；填写 styles 表示 styles
                    目录。范围匹配不等于语义理解。
                  </p>
                  <button className="primary full" disabled={busy || !!running}>
                    {editing ? "保存修订，替代旧标准" : "保存为持续标准"}
                  </button>
                </form>
              </>
            ) : (
              <>
                <div className="modal-icon">
                  <Code2 size={24} />
                </div>
                <h2>让 PiLoop 开始工作</h2>
                <p>
                  这是实际连接 Pi SDK 的 Coding Agent。没有模型凭据时，不会模拟
                  Agent 成功。
                </p>
                <ol className="setup-list">
                  <li>
                    <b>连接一个静态网页项目</b>
                    <span>
                      也可以先打开内置示例，体验预览、浏览器检查和反馈保存。
                    </span>
                  </li>
                  <li>
                    <b>配置模型凭据</b>
                    <span>
                      启动前设置供应商环境变量（例如 ANTHROPIC_API_KEY），或通过
                      PILOOP_AUTH_FILE 明确指定已有 Pi 凭据路径。配置见 README。
                    </span>
                  </li>
                  <li>
                    <b>重启 PiLoop 并选择模型</b>
                    <span>
                      任务会把相关代码和反馈发送给所选模型供应商。密钥不在网页展示。
                    </span>
                  </li>
                </ol>
                <div className="help-note">
                  候选是独立本地副本。采用候选只更新 PiLoop
                  的当前版本，不发布网站，也不覆盖原目录。V0 暂不运行 npm
                  构建、Shell 或外部网络资源。
                </div>
                <button className="primary full" onClick={() => setModal(null)}>
                  知道了
                </button>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
