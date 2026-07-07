---
name: credit-box-design
description: Design and implement the reusable personal APP DESIGN credit/contact box for web apps, tools, dashboards, and sidebars. Use when the user wants to add the exact Dư Ngọc Minh Hoàng credit box with phone, Zalo, Telegram, and WeChat QR popup contact methods to another website or app.
---

# Credit Box Design

Use this skill to add a compact, polished personal credit/contact box to a web app. The box must identify the app designer and provide fast contact actions without distracting from the main tool.

## Fixed Content

Use this content exactly unless the user explicitly asks to change it:

- Name: `Dư Ngọc Minh Hoàng`
- Label: `APP DESIGN`
- Phone: `(+84) 904002301`
- Zalo link: `https://zalo.me/0904002301`
- Telegram label: `@dungocminhhoang`
- Telegram link: `https://t.me/dungocminhhoang`
- WeChat button: opens an in-app modal/popup, not a link
- WeChat note in popup: `WeChat ID: DuNgocMinhHoang`
- WeChat QR payload: `https://u.wechat.com/kNE1QLDxXUun5q04_FphdtE?s=2`

## Placement

- Place the credit box near the bottom of the app chrome: sidebar footer, settings panel footer, or tool footer.
- Keep it small. It should feel like a designer signature/contact widget, not a marketing card.
- Do not place it inside another decorative card when the surrounding UI already uses panels.
- If the app has a fixed sidebar, dock the credit box above the bottom edge or above the theme/settings footer.

## Layout

- Use a compact box with 8px or smaller radius.
- Header row:
  - Left: `Dư Ngọc Minh Hoàng`
  - Right: `APP DESIGN`
- Contact row 1:
  - phone icon
  - `(+84) 904002301`
  - Zalo pill button aligned to the far right
- Contact row 2:
  - send/message icon
  - Telegram link
  - WeChat pill button aligned to the far right
- Add a subtle vertical accent strip on the left side.

## Interaction

- Zalo opens `https://zalo.me/0904002301` in a new tab.
- Telegram opens `https://t.me/dungocminhhoang` in a new tab.
- WeChat opens a centered modal with a QR code and the note `WeChat ID: DuNgocMinhHoang`.
- The WeChat modal should close when clicking outside the popup.
- Do not add a visible close button unless the project style requires it.
- Generate the WeChat QR from the payload above when the project has a QR library available. If not, ask for or reuse a provided QR image asset.

## Visual Style

- Prefer a white surface with red accent to match the signature style.
- Recommended colors:
  - text: `#172033`
  - muted text: `#475467`
  - red: `#dc2626`
  - deep red: `#991b1b`
  - soft red background: `rgba(220, 38, 38, 0.08)`
  - border: `rgba(220, 38, 38, 0.18)`
- Use small typography:
  - name around 11px
  - label/pill around 9px
  - contact rows around 10px
- Use a restrained shadow. The credit box should be readable but not visually heavy.
- Keep labels on one line where possible.

## React Pattern

Use this structure as a starting point and adapt class names to the project:

```tsx
const wechatQrPayload = "https://u.wechat.com/kNE1QLDxXUun5q04_FphdtE?s=2";

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
      if (!canceled) setWechatQrCode(dataUrl);
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
```

## CSS Pattern

Use this CSS as a compact default. Adjust only enough to match the host app.

```css
.designer-credit {
  position: relative;
  display: grid;
  gap: 5px;
  padding: 9px 10px 9px 13px;
  color: #172033;
  background:
    linear-gradient(135deg, rgba(220, 38, 38, 0.08), rgba(255, 255, 255, 0.96)),
    #ffffff;
  border: 1px solid rgba(220, 38, 38, 0.18);
  border-radius: 8px;
  box-shadow: 0 12px 24px rgba(15, 23, 42, 0.07);
}

.designer-credit::before {
  content: "";
  position: absolute;
  top: 9px;
  bottom: 9px;
  left: 6px;
  width: 2px;
  border-radius: 999px;
  background: linear-gradient(180deg, #ef4444, #7f1d1d);
}

.credit-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: baseline;
  gap: 8px;
}

.designer-credit strong {
  justify-self: start;
  color: #111827;
  font-size: 11px;
  line-height: 1.15;
  text-align: left;
  white-space: nowrap;
}

.credit-kicker {
  color: #dc2626;
  font-size: 9px;
  font-weight: 900;
  line-height: 1;
  text-transform: uppercase;
  letter-spacing: 0;
}

.credit-row {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 100%;
  min-width: 0;
  color: #475467;
  font-size: 10px;
  font-weight: 700;
  line-height: 1.2;
}

.credit-row svg {
  flex: 0 0 auto;
  color: #dc2626;
  stroke-width: 2.3;
  width: 12px;
  height: 12px;
}

.credit-link {
  min-width: 0;
  color: #475467;
  text-decoration: none;
}

.credit-link:hover {
  color: #991b1b;
  text-decoration: underline;
}

.credit-zalo,
.credit-wechat {
  margin-left: auto;
  padding: 2px 6px;
  color: #ffffff;
  background: linear-gradient(135deg, #dc2626, #991b1b);
  border: 0;
  border-radius: 999px;
  font-size: 9px;
  font-weight: 900;
  line-height: 1.1;
  text-decoration: none;
  cursor: pointer;
}

.credit-zalo:hover,
.credit-wechat:hover {
  background: linear-gradient(135deg, #ef4444, #7f1d1d);
}

.wechat-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.38);
  backdrop-filter: blur(8px);
}

.wechat-modal {
  display: grid;
  gap: 10px;
  justify-items: center;
  padding: 16px;
  color: #172033;
  background: #ffffff;
  border: 1px solid rgba(220, 38, 38, 0.18);
  border-radius: 8px;
  box-shadow: 0 24px 80px rgba(15, 23, 42, 0.22);
}

.wechat-modal img {
  display: block;
  width: min(230px, 70vw);
  height: auto;
}

.wechat-modal span {
  color: #172033;
  font-size: 13px;
  font-weight: 800;
}
```

## Implementation Checklist

- Import or replace icons for phone and Telegram/message. Prefer `lucide-react` icons `Phone` and `Send` when available.
- Add QR generation dependency only if the project already uses or accepts it. For React, `qrcode` works well.
- Keep the box compact on mobile and desktop.
- Verify external links open in a new tab with `rel="noreferrer"`.
- Verify WeChat popup closes by clicking outside the modal.
- Do not add explanatory text such as "designed by" outside the fixed `APP DESIGN` label.
