import { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  FileImage,
  ImagePlus,
  Loader2,
  Phone,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";
import QRCode from "qrcode";

const maxFiles = 4;
const maxCompressedImageBytes = 900 * 1024;
const maxCompressedImageSide = 1600;
const estimatedRunMs = 264000;
const wechatQrPayload = "https://u.wechat.com/kNE1QLDxXUun5q04_FphdtE?s=2";

const progressStages = [
  { to: 8, duration: 8000, title: "Đang upload ảnh nguồn", note: "Kiểm tra định dạng, dung lượng và chuẩn bị dữ liệu xử lý." },
  { to: 18, duration: 18000, title: "Đang khởi tạo phiên xử lý", note: "Tạo session riêng và khóa cấu hình đầu ra." },
  { to: 34, duration: 42000, title: "Đang phân tích khuôn mặt", note: "Đối chiếu các ảnh tham chiếu của cùng một người." },
  { to: 52, duration: 56000, title: "Đang dựng ảnh thẻ chuyên nghiệp", note: "Giữ nhận diện nhất quán và làm sạch ánh sáng studio." },
  { to: 68, duration: 52000, title: "Đang xử lý nền trắng", note: "Tách nền, cân bằng viền tóc và làm phẳng background." },
  { to: 79, duration: 38000, title: "Đang tinh chỉnh chi tiết", note: "Cân chỉnh da, độ nét khuôn mặt và màu sắc tổng thể." },
  { to: 88, duration: 30000, title: "Đang căn khung 4x6 cm", note: "Đặt tỉ lệ dọc, khoảng trống đầu và vai theo chuẩn ảnh thẻ." },
  { to: 94, duration: 20000, title: "Đang chuẩn hóa file xuất", note: "Resize 945x1417 px, gắn 600 DPI và tối ưu dung lượng JPG." },
];

function easeOutCubic(value) {
  return 1 - Math.pow(1 - value, 3);
}

function getProgressSnapshot(elapsedMs, fileCount) {
  let elapsedCursor = 0;
  let previousPercent = 0;

  for (const stage of progressStages) {
    const stageEnd = elapsedCursor + stage.duration;
    if (elapsedMs <= stageEnd) {
      const localProgress = Math.max(0, Math.min(1, (elapsedMs - elapsedCursor) / stage.duration));
      const percent = previousPercent + (stage.to - previousPercent) * easeOutCubic(localProgress);
      return {
        percent: Math.min(97, Math.round(percent)),
        title: stage.title,
        note: stage.note,
        detail: `${fileCount} ảnh tham chiếu`,
      };
    }
    elapsedCursor = stageEnd;
    previousPercent = stage.to;
  }

  const overtimeProgress = Math.min(3, ((elapsedMs - estimatedRunMs) / 30000) * 3);
  return {
    percent: Math.round(94 + overtimeProgress),
    title: "Đang chờ model hoàn tất",
    note: "API vẫn đang xử lý ảnh. Kết quả sẽ tự động cập nhật khi server trả về.",
    detail: `${fileCount} ảnh tham chiếu`,
  };
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function makeSessionId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function blobFromCanvas(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Khong nen duoc anh."));
          return;
        }
        resolve(blob);
      },
      "image/jpeg",
      quality,
    );
  });
}

async function loadImageFile(file) {
  if ("createImageBitmap" in window) {
    return createImageBitmap(file);
  }

  const imageUrl = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Khong doc duoc anh."));
      image.src = imageUrl;
    });
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

async function compressImageFile(file) {
  const image = await loadImageFile(file);
  const sourceWidth = image.width;
  const sourceHeight = image.height;
  const baseScale = Math.min(1, maxCompressedImageSide / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false });
  let scale = baseScale;
  let bestBlob = null;

  for (let resizeAttempt = 0; resizeAttempt < 4; resizeAttempt += 1) {
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    for (const quality of [0.86, 0.78, 0.7, 0.62, 0.54]) {
      const blob = await blobFromCanvas(canvas, quality);
      bestBlob = blob;
      if (blob.size <= maxCompressedImageBytes) {
        break;
      }
    }

    if (bestBlob?.size <= maxCompressedImageBytes) {
      break;
    }
    scale *= 0.82;
  }

  if (typeof image.close === "function") {
    image.close();
  }

  const baseName = file.name.replace(/\.[^.]+$/, "") || "image";
  const compressedFile = new File([bestBlob], `${baseName}-compressed.jpg`, {
    type: "image/jpeg",
    lastModified: Date.now(),
  });

  return Object.assign(compressedFile, {
    originalName: file.name,
    originalSize: file.size,
    compressed: true,
  });
}

function DesignerCredit() {
  const [wechatOpen, setWechatOpen] = useState(false);
  const [wechatQrCode, setWechatQrCode] = useState("");

  useEffect(() => {
    let canceled = false;
    QRCode.toDataURL(wechatQrPayload, {
      margin: 1,
      width: 360,
      color: { dark: "#111827", light: "#ffffff" },
    }).then((dataUrl) => {
      if (!canceled) {
        setWechatQrCode(dataUrl);
      }
    });
    return () => {
      canceled = true;
    };
  }, []);

  return (
    <>
      <div className="designer-credit" aria-label="Tool designer contact">
        <div className="credit-head">
          <strong>Dư Ngọc Minh Hoàng</strong>
          <span className="credit-kicker">APP DESIGN</span>
        </div>
        <div className="credit-row">
          <Phone size={14} />
          <span>(+84) 904002301</span>
          <a className="credit-zalo" href="https://zalo.me/0904002301" target="_blank" rel="noreferrer">
            Zalo
          </a>
        </div>
        <div className="credit-row">
          <Send size={14} />
          <a className="credit-link" href="https://t.me/dungocminhhoang" target="_blank" rel="noreferrer">
            @dungocminhhoang
          </a>
          <button className="credit-wechat" type="button" onClick={() => setWechatOpen(true)}>
            WeChat
          </button>
        </div>
      </div>

      {wechatOpen ? (
        <div className="wechat-modal-backdrop" onMouseDown={() => setWechatOpen(false)}>
          <div className="wechat-modal" onMouseDown={(event) => event.stopPropagation()}>
            {wechatQrCode ? <img src={wechatQrCode} alt="WeChat QR" /> : null}
            <span>WeChat ID: DuNgocMinhHoang</span>
          </div>
        </div>
      ) : null}
    </>
  );
}

function ProgressConsole({ progress }) {
  const steps = [
    ["Upload", 8],
    ["Phân tích", 34],
    ["Dựng ảnh", 52],
    ["Nền trắng", 68],
    ["4x6", 88],
    ["JPG", 94],
  ];

  return (
    <div className="progress-console" aria-live="polite">
      <div className="progress-head">
        <div>
          <strong>{progress.title}</strong>
          <span>{progress.note}</span>
        </div>
        <b>{progress.percent}%</b>
      </div>
      <div className="progress-track" aria-label="Tiến trình xử lý ảnh">
        <div className="progress-fill" style={{ width: `${progress.percent}%` }} />
      </div>
      <div className="progress-meta">
        <span>{progress.detail}</span>
      </div>
      <div className="progress-steps">
        {steps.map(([label, threshold]) => (
          <span className={progress.percent >= threshold ? "done" : ""} key={label}>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function SessionStatus({ status }) {
  const labelMap = {
    queued: "Đang chờ",
    processing: "Đang xử lý",
    done: "Hoàn tất",
    failed: "Lỗi",
  };
  return <span className={`session-status ${status}`}>{labelMap[status] || status}</span>;
}

function App() {
  const inputRef = useRef(null);
  const filesRef = useRef([]);
  const sessionsRef = useRef([]);
  const [files, setFiles] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [config, setConfig] = useState(null);
  const [outputFormat, setOutputFormat] = useState("jpg");
  const [isDragging, setIsDragging] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/api/config")
      .then((response) => response.json())
      .then(setConfig)
      .catch(() => {
        setConfig({
          model: "gpt-image-2-all",
          target: { label: "4x6 cm", width: 945, height: 1417, dpi: 600 },
        });
      });
  }, []);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    return () => {
      filesRef.current.forEach((file) => URL.revokeObjectURL(file.previewUrl));
      sessionsRef.current.forEach((session) => {
        session.files.forEach((file) => URL.revokeObjectURL(file.previewUrl));
      });
    };
  }, []);

  const canCreateSession = !isCompressing && files.length > 0 && files.length <= maxFiles;
  const summary = useMemo(() => {
    const done = sessions.filter((session) => session.status === "done").length;
    const failed = sessions.filter((session) => session.status === "failed").length;
    const queued = sessions.filter((session) => session.status === "queued").length;
    const processing = sessions.filter((session) => session.status === "processing").length;
    return { done, failed, queued, processing };
  }, [sessions]);

  useEffect(() => {
    if (activeSessionId) {
      return;
    }

    const nextSession = sessions.find((session) => session.status === "queued");
    if (nextSession) {
      processSession(nextSession);
    }
  }, [activeSessionId, sessions]);

  function updateSession(sessionId, patch) {
    setSessions((current) =>
      current.map((session) => (session.id === sessionId ? { ...session, ...patch } : session)),
    );
  }

  function cancelQueuedSession(sessionId) {
    setSessions((current) => {
      const target = current.find((session) => session.id === sessionId);
      if (!target || target.status !== "queued") {
        return current;
      }
      target.files.forEach((file) => URL.revokeObjectURL(file.previewUrl));
      return current.filter((session) => session.id !== sessionId);
    });
    setMessage("Đã hủy session đang chờ.");
  }

  async function processSession(session) {
    setActiveSessionId(session.id);
    updateSession(session.id, {
      status: "processing",
      message: "Session đang được xử lý",
      progress: getProgressSnapshot(0, session.files.length),
    });

    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      updateSession(session.id, {
        progress: getProgressSnapshot(Date.now() - startedAt, session.files.length),
      });
    }, 900);

    const formData = new FormData();
    session.files.forEach((file) => formData.append("images", file));
    formData.append("outputFormat", session.outputFormat);

    try {
      const response = await fetch("/api/process", {
        method: "POST",
        body: formData,
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Không xử lý được ảnh.");
      }

      const hasFailure = Boolean(payload.summary?.failed);
      updateSession(session.id, {
        progress: {
          percent: 100,
          title: hasFailure ? "Đã hoàn tất lượt xử lý" : "Hoàn tất ảnh thẻ",
          note: hasFailure ? "Session cần kiểm tra lại trong preview." : "Ảnh đã sẵn sàng để xem trước và tải xuống.",
          detail: hasFailure ? "Kết quả cần kiểm tra" : `Hoàn thành 1 ảnh thẻ từ ${session.files.length} ảnh tham chiếu`,
        },
        message: hasFailure ? "Có lỗi trong kết quả trả về" : "Hoàn tất xử lý ảnh thẻ",
      });
      await wait(650);
      updateSession(session.id, {
        status: hasFailure ? "failed" : "done",
        results: payload.results || [],
        summary: payload.summary,
        message: hasFailure ? "Một số ảnh chưa xử lý được" : "Đã có ảnh kết quả",
      });
    } catch (error) {
      updateSession(session.id, {
        status: "failed",
        results: [
          {
            originalName: `${session.files.length} ảnh tham chiếu`,
            error: error.message,
          },
        ],
        progress: {
          percent: 100,
          title: "Không hoàn tất lượt xử lý",
          note: "Server đã trả lỗi. Vui lòng kiểm tra thông báo và thử lại sau.",
          detail: "Lượt xử lý đã dừng",
        },
        message: error.message,
      });
    } finally {
      window.clearInterval(timer);
      setActiveSessionId("");
    }
  }

  async function addFiles(nextFileList) {
    const imageFiles = Array.from(nextFileList).filter((file) => file.type.startsWith("image/"));
    const remainingSlots = maxFiles - files.length;
    const acceptedFiles = imageFiles.slice(0, Math.max(0, remainingSlots));

    if (!imageFiles.length) {
      setMessage("File khong hop le. Vui long chon anh.");
      return;
    }

    if (!acceptedFiles.length) {
      setMessage(`Toi da ${maxFiles} anh cho moi session.`);
      return;
    }

    setIsCompressing(true);
    setMessage(`Dang nen ${acceptedFiles.length} anh truoc khi upload...`);

    try {
      const compressedFiles = await Promise.all(acceptedFiles.map((file) => compressImageFile(file)));
      const mappedCompressed = compressedFiles.map((file) => Object.assign(file, { previewUrl: URL.createObjectURL(file) }));
      const originalTotal = acceptedFiles.reduce((total, file) => total + file.size, 0);
      const compressedTotal = compressedFiles.reduce((total, file) => total + file.size, 0);
      const savedPercent = Math.max(0, Math.round((1 - compressedTotal / originalTotal) * 100));

      setFiles((current) => [...current, ...mappedCompressed]);
      setMessage(`Da nen ${compressedFiles.length} anh: ${formatBytes(originalTotal)} -> ${formatBytes(compressedTotal)}${savedPercent ? `, giam ${savedPercent}%` : ""}.`);
    } catch (error) {
      setMessage(error.message || "Khong nen duoc anh. Vui long thu anh khac.");
    } finally {
      setIsCompressing(false);
    }
    return;

    const mapped = acceptedFiles.map((file) => Object.assign(file, { previewUrl: URL.createObjectURL(file) }));
    setFiles((current) => [...current, ...mapped]);
    setMessage(imageFiles.length ? "" : "File không hợp lệ. Vui lòng chọn ảnh.");
  }

  function removeFile(index) {
    setFiles((current) => {
      const next = [...current];
      const [removed] = next.splice(index, 1);
      if (removed?.previewUrl) {
        URL.revokeObjectURL(removed.previewUrl);
      }
      return next;
    });
  }

  function createSession() {
    if (!canCreateSession) {
      return;
    }

    const sessionFiles = files;
    const sessionNumber = sessions.length + 1;
    const sessionId = makeSessionId();

    setSessions((current) => [
      ...current,
      {
        id: sessionId,
        name: `Session ${sessionNumber}`,
        files: sessionFiles,
        outputFormat,
        status: "queued",
        message: "Đã đưa vào hàng chờ",
        progress: getProgressSnapshot(0, sessionFiles.length),
        results: [],
        summary: null,
        createdAt: Date.now(),
      },
    ]);
    setFiles([]);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
    setMessage(`Đã tạo Session ${sessionNumber} với ${sessionFiles.length} ảnh tham chiếu.`);
  }

  function resetAll() {
    files.forEach((file) => URL.revokeObjectURL(file.previewUrl));
    sessions.forEach((session) => {
      session.files.forEach((file) => URL.revokeObjectURL(file.previewUrl));
    });
    setFiles([]);
    setSessions([]);
    setActiveSessionId("");
    setMessage("");
  }

  const resultSessions = sessions.filter((session) => session.status === "done" || session.status === "failed");
  const resultItems = resultSessions.flatMap((session) =>
    (session.results || []).map((item) => ({
      ...item,
      sessionName: session.name,
      sessionId: session.id,
    })),
  );

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <FileImage size={22} />
          </div>
          <div>
            <h1>Photo ID Studio</h1>
            <p>Ảnh thẻ 4x6 cm, 600 DPI</p>
          </div>
        </div>

        <div className="sidebar-spacer" />

        <section className="control-block">
          <div className="preset-row">
            <span>Kích thước</span>
            <strong>{config?.target?.width || 945} x {config?.target?.height || 1417}px</strong>
          </div>
          <div className="preset-row">
            <span>DPI</span>
            <strong>{config?.target?.dpi || 600}</strong>
          </div>
          <div className="format-switch" aria-label="Định dạng xuất ảnh">
            <button className={outputFormat === "png" ? "active" : ""} type="button" onClick={() => setOutputFormat("png")}>
              PNG
            </button>
            <button className={outputFormat === "jpg" ? "active" : ""} type="button" onClick={() => setOutputFormat("jpg")}>
              JPG
            </button>
          </div>
        </section>

        <DesignerCredit />
      </aside>

      <section className="workspace">
        <header className="workspace-head">
          <div>
            <p className="eyebrow">Dashboard preview</p>
            <h2>Tạo ảnh thẻ nền trắng từ ảnh upload</h2>
          </div>
          <div className="status-pill">
            {summary.processing ? "1 session đang xử lý" : `${sessions.length} session`}
          </div>
        </header>

        {message ? <div className={`notice ${summary.failed ? "warn" : ""}`}>{message}</div> : null}

        <div className="workspace-grid sessions-layout">
          <section className="panel session-panel">
            <div className="panel-head">
              <h3>Session chờ xử lý</h3>
              <span>{summary.queued} chờ · {summary.processing} chạy</span>
            </div>
            <div className="session-list">
              {sessions.length ? (
                sessions.map((session) => (
                  <article className={`session-card ${session.status}`} key={session.id}>
                    <div className="session-card-head">
                      <div>
                        <strong>{session.name}</strong>
                        <span>{session.files.length} ảnh input · {session.outputFormat.toUpperCase()}</span>
                      </div>
                      <SessionStatus status={session.status} />
                    </div>
                    <div className="session-thumbs">
                      {session.files.map((file, index) => (
                        <img src={file.previewUrl} alt={`${session.name} input ${index + 1}`} key={`${session.id}-${file.name}-${index}`} />
                      ))}
                    </div>
                    {session.status === "processing" ? (
                      <ProgressConsole progress={session.progress} />
                    ) : (
                      <p className="session-note">{session.message}</p>
                    )}
                    {session.status === "queued" ? (
                      <button className="cancel-session" type="button" onClick={() => cancelQueuedSession(session.id)}>
                        Hủy session
                      </button>
                    ) : null}
                  </article>
                ))
              ) : (
                <div className="empty-state">Chưa có session</div>
              )}
            </div>
          </section>

          <section className="panel result-panel">
            <div className="panel-head">
              <h3>Kết quả</h3>
            </div>
            <div className="result-grid clean-results">
              {resultItems.length ? (
                resultItems.map((item, index) => (
                  <article className={`result-card clean-result-card ${item.error ? "failed" : ""}`} key={`${item.sessionId}-${item.fileName || item.originalName}-${index}`}>
                    {item.url ? (
                      <>
                        <div className="photo-frame">
                          <img src={item.url} alt={`Ảnh thẻ ${item.sessionName}`} />
                          <div className="result-hover-title">{item.sessionName}</div>
                          <a className="result-download-icon" href={item.url} download={item.fileName} aria-label={`Tải ảnh ${item.sessionName}`}>
                            <Download size={18} />
                          </a>
                        </div>
                      </>
                    ) : (
                      <div className="failed-box">{item.error}</div>
                    )}
                  </article>
                ))
              ) : (
                <div className="empty-state">Kết quả sẽ xuất hiện tại đây.</div>
              )}
            </div>
          </section>
        </div>

        <section
          className={`upload-dock ${isDragging ? "is-dragging" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setIsDragging(false);
            void addFiles(event.dataTransfer.files);
          }}
        >
          <div className="upload-dock-main">
            <button className="upload-picker" type="button" disabled={isCompressing} onClick={() => inputRef.current?.click()}>
              <ImagePlus size={22} />
              <span>
                <strong>Upload 1-4 ảnh của cùng 1 người, nhiều ảnh rõ ràng thì chất lượng ảnh thẻ càng chính xác</strong>
              </span>
            </button>
            <div className="dock-thumbnails" aria-label="Ảnh đã upload">
              {files.length ? (
                files.map((file, index) => (
                  <article className="dock-thumb" key={`${file.name}-${index}`}>
                    <img src={file.previewUrl} alt={file.name} />
                    <div>
                      <strong>{file.name}</strong>
                      <span>
                        {formatBytes(file.size)}
                        {file.originalSize && file.originalSize > file.size ? ` tu ${formatBytes(file.originalSize)}` : ""}
                      </span>
                    </div>
                    <button type="button" onClick={() => removeFile(index)} aria-label={`Xóa ${file.name}`}>
                      <Trash2 size={15} />
                    </button>
                  </article>
                ))
              ) : (
                <div className="dock-empty">Khay upload đang trống, có thể thêm bộ ảnh tiếp theo.</div>
              )}
            </div>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={(event) => {
                void addFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </div>

          <div className="dock-actions">
            <button className="primary-action dock-process" type="button" disabled={!canCreateSession} onClick={createSession}>
              {isCompressing ? <Loader2 className="spin" size={20} /> : <Sparkles size={20} />}
              Xử lý ảnh
            </button>
          </div>
        </section>
      </section>
    </main>
  );
}

export default App;
