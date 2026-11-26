import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { Button } from "../Button.js";
import { cx } from "../cx.js";
import { PackCard } from "./PackCard.js";
const PRESETS = [
    { id: "suite", label: "Suite" },
    { id: "solarized", label: "Solarized" },
    { id: "warm", label: "Warm" },
];
const MODES = [
    { id: "light", label: "Light" },
    { id: "dark", label: "Dark" },
];
const DENSITY_OPTIONS = [
    { id: "compact", label: "Compact" },
    { id: "cozy", label: "Cozy" },
    { id: "comfortable", label: "Comfortable" },
];
function StepRail({ step }) {
    const steps = [
        { id: "apps", label: "Apps" },
        { id: "appearance", label: "Look" },
        { id: "install", label: "Install" },
    ];
    return (_jsx("ol", { "aria-label": "Setup steps", className: "m-0 flex list-none flex-wrap items-center gap-2 p-0", children: steps.map((item, index) => {
            const active = item.id === step;
            return (_jsxs("li", { className: "flex items-center gap-2", children: [_jsx("span", { "aria-hidden": "true", className: cx("flex h-6 w-6 items-center justify-center rounded-full text-[length:var(--text-caption,11px)]", active
                            ? "bg-[var(--accent)] text-[var(--on-accent)]"
                            : "bg-[var(--surface-sunk)] text-[var(--ink-muted)]"), children: index + 1 }), _jsx("span", { className: cx("text-[length:var(--text-label,12px)]", active ? "text-[var(--ink)]" : "text-[var(--ink-muted)]"), children: item.label }), index < steps.length - 1 ? (_jsx("span", { "aria-hidden": "true", className: "text-[var(--ink-faint)]", children: "/" })) : null] }, item.id));
        }) }));
}
function Choice({ label, selected, onClick, }) {
    return (_jsx("button", { type: "button", "aria-pressed": selected, onClick: onClick, className: cx("rounded-md border px-2.5 py-1.5 text-[length:var(--text-label,12px)]", selected
            ? "border-[var(--accent)] bg-[var(--surface-strong)] text-[var(--ink)]"
            : "border-[var(--hairline)] bg-[var(--surface)] text-[var(--ink-muted)]"), children: label }));
}
function Appearance({ theme, onThemeChange, }) {
    return (_jsxs("div", { className: "grid gap-5 md:grid-cols-[1fr_260px]", children: [_jsxs("div", { className: "flex flex-col gap-4", children: [_jsxs("section", { children: [_jsx("h2", { className: "text-[length:var(--text-title,15px)] font-semibold normal-case text-[var(--ink)]", children: "Palette" }), _jsx("div", { className: "mt-2 flex flex-wrap gap-2", children: PRESETS.map((preset) => (_jsx(Choice, { label: preset.label, selected: theme.preset === preset.id, onClick: () => onThemeChange({ ...theme, preset: preset.id }) }, preset.id))) })] }), _jsxs("section", { children: [_jsx("h2", { className: "text-[length:var(--text-title,15px)] font-semibold normal-case text-[var(--ink)]", children: "Brightness" }), _jsx("div", { className: "mt-2 flex flex-wrap gap-2", children: MODES.map((mode) => (_jsx(Choice, { label: mode.label, selected: theme.mode === mode.id, onClick: () => onThemeChange({ ...theme, mode: mode.id }) }, mode.id))) })] }), _jsxs("section", { children: [_jsx("h2", { className: "text-[length:var(--text-title,15px)] font-semibold normal-case text-[var(--ink)]", children: "Density" }), _jsx("p", { className: "mt-1 text-[length:var(--text-label,12px)] text-[var(--ink-muted)]", children: "How much room controls and lists get. The type stays the same." }), _jsx("div", { className: "mt-2 flex flex-wrap gap-2", children: DENSITY_OPTIONS.map((density) => (_jsx(Choice, { label: density.label, selected: theme.density === density.id, onClick: () => onThemeChange({ ...theme, density: density.id }) }, density.id))) })] })] }), _jsxs("div", { className: "rounded-lg border border-[var(--hairline)] bg-[var(--surface)] p-4", children: [_jsx("p", { className: "text-[length:var(--text-caption,11px)] uppercase tracking-wide text-[var(--ink-faint)]", children: "Preview" }), _jsx("p", { className: "mt-2 text-[length:var(--text-title,15px)] text-[var(--ink)]", children: "A calm place to work" }), _jsx("p", { className: "mt-1 text-[length:var(--text-label,12px)] text-[var(--ink-muted)]", children: "Your files stay on this device." }), _jsxs("div", { className: "mt-3 flex gap-2", children: [_jsx(Button, { variant: "primary", size: "sm", children: "Continue" }), _jsx(Button, { variant: "ghost", size: "sm", children: "Later" })] })] })] }));
}
function InstallList({ packs, rows, }) {
    return (_jsx("ul", { className: "m-0 flex list-none flex-col gap-2 p-0", children: rows.map((row) => {
            const pack = packs.find((candidate) => candidate.id === row.id);
            const percent = row.state === "installed" ? 100 : row.state === "installing" ? 62 : 0;
            return (_jsxs("li", { className: "flex items-center gap-3 rounded-lg border border-[var(--hairline)] bg-[var(--surface)] p-3", children: [_jsx("span", { "aria-hidden": "true", className: "flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[var(--surface-sunk)] text-[length:var(--text-title,15px)] text-[var(--ink-muted)]", children: (pack?.name ?? row.id).slice(0, 1) }), _jsxs("span", { className: "min-w-0 flex-1", children: [_jsx("span", { className: "block text-[length:var(--text-title,15px)] text-[var(--ink)]", children: pack?.name ?? row.id }), _jsx("span", { className: "mt-0.5 block text-[length:var(--text-caption,11px)] text-[var(--ink-muted)]", children: row.detail }), row.state === "installing" ? (_jsx("span", { role: "progressbar", "aria-label": `Installing ${pack?.name ?? row.id}`, "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": percent, className: "mt-2 block h-1.5 overflow-hidden rounded-full bg-[var(--surface-sunk)]", children: _jsx("span", { className: "block h-full rounded-full bg-[var(--accent)]", style: { width: `${percent}%` } }) })) : null] }), _jsx("span", { className: cx("shrink-0 text-[length:var(--text-caption,11px)]", row.state === "failed" ? "text-[var(--danger)]" : "text-[var(--ink-muted)]"), children: row.state === "failed" ? "Failed" : row.state === "installed" ? "Done" : "" })] }, row.id));
        }) }));
}
export function FirstRun({ packs, theme, onThemeChange, onInstall, onComplete, initialStep = "apps", initialSelected, initialRows, }) {
    const [step, setStep] = useState(initialStep);
    const [selected, setSelected] = useState(() => new Set(initialSelected ?? packs.map((pack) => pack.id)));
    const [rows, setRows] = useState(initialRows ?? []);
    const [busy, setBusy] = useState(false);
    const chosen = packs.filter((pack) => selected.has(pack.id));
    function toggle(id) {
        setSelected((current) => {
            const next = new Set(current);
            if (next.has(id))
                next.delete(id);
            else
                next.add(id);
            return next;
        });
    }
    async function install(ids) {
        setBusy(true);
        await Promise.all(ids.map(async (id) => {
            setRows((current) => current.map((row) => (row.id === id ? { ...row, state: "installing", detail: "Installing…" } : row)));
            try {
                const result = await onInstall(id);
                setRows((current) => current.map((row) => row.id === id
                    ? {
                        ...row,
                        state: result.ok ? "installed" : "failed",
                        detail: result.detail,
                    }
                    : row));
            }
            catch (error) {
                setRows((current) => current.map((row) => row.id === id
                    ? {
                        ...row,
                        state: "failed",
                        detail: error instanceof Error ? error.message : "The install was refused.",
                    }
                    : row));
            }
        }));
        setBusy(false);
    }
    function startInstall() {
        if (chosen.length === 0) {
            onComplete();
            return;
        }
        const ids = chosen.map((pack) => pack.id);
        setRows(ids.map((id) => ({ id, state: "queued", detail: "Waiting" })));
        setStep("install");
        void install(ids);
    }
    const finished = rows.length > 0 && rows.every((row) => row.state === "installed");
    return (_jsxs("div", { className: "mx-auto flex h-[720px] w-full max-w-[1240px] flex-col overflow-hidden rounded-xl border border-[var(--hairline)] bg-[var(--canvas)] text-[var(--ink)] shadow-[var(--shadow-xl)]", children: [_jsxs("div", { className: "flex items-center justify-between border-b border-[var(--hairline)] px-6 py-4", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { "aria-hidden": "true", className: "flex h-7 w-7 items-center justify-center rounded-md bg-[var(--accent)]", children: _jsx("span", { className: "h-2.5 w-2.5 rotate-45 bg-[var(--on-accent)]" }) }), _jsx("span", { className: "text-[length:var(--text-title,15px)]", children: "Suite" })] }), _jsx(StepRail, { step: step })] }), _jsxs("main", { className: "min-h-0 flex-1 overflow-auto px-8 py-8", children: [step === "apps" ? (_jsxs("div", { className: "mx-auto max-w-[760px]", children: [_jsx("h1", { className: "text-[length:var(--text-display,34px)]", children: "Welcome to Suite." }), _jsx("p", { className: "mt-3 max-w-[62ch] text-[length:var(--text-body,13px)] leading-relaxed text-[var(--ink-muted)]", children: "Suite is a home for small apps that keep their files on your device. Choose the ones you want now; you can add or remove them later." }), _jsx("div", { className: "mt-6 grid gap-2 sm:grid-cols-2", children: packs.map((pack) => (_jsx(PackCard, { name: pack.name, ...(pack.description === undefined ? {} : { description: pack.description }), status: pack.status ?? "available", ...(pack.version === undefined ? {} : { version: pack.version }), selected: selected.has(pack.id), onSelect: () => toggle(pack.id) }, pack.id))) }), _jsxs("div", { className: "mt-6 flex flex-wrap items-center gap-2", children: [_jsx(Button, { variant: "primary", onClick: () => setStep("appearance"), children: "Continue" }), _jsx(Button, { variant: "ghost", onClick: () => {
                                            setSelected(new Set());
                                            setStep("appearance");
                                        }, children: "Skip choosing for now" }), _jsx("span", { className: "text-[length:var(--text-caption,11px)] text-[var(--ink-faint)]", children: chosen.length === 0 ? "No apps selected" : `${chosen.length} selected` })] })] })) : null, step === "appearance" ? (_jsxs("div", { className: "mx-auto max-w-[860px]", children: [_jsx("h1", { className: "text-[length:var(--text-display,34px)]", children: "Make it yours." }), _jsx("p", { className: "mt-3 max-w-[62ch] text-[length:var(--text-body,13px)] leading-relaxed text-[var(--ink-muted)]", children: "Pick a palette, a brightness and how much room controls get. The apps follow the host, so this choice is the one every app opens in." }), _jsx("div", { className: "mt-6", children: _jsx(Appearance, { theme: theme, onThemeChange: onThemeChange }) }), _jsxs("div", { className: "mt-6 flex flex-wrap gap-2", children: [_jsx(Button, { variant: "primary", onClick: startInstall, children: chosen.length === 0
                                            ? "Continue to Home"
                                            : `Install ${chosen.length === 1 ? "1 app" : `${chosen.length} apps`}` }), _jsx(Button, { variant: "ghost", onClick: () => setStep("apps"), children: "Back" })] })] })) : null, step === "install" ? (_jsxs("div", { className: "mx-auto max-w-[620px]", children: [_jsx("h1", { className: "text-[length:var(--text-display,34px)]", children: finished ? "You’re set." : "Installing your apps." }), _jsx("p", { className: "mt-3 text-[length:var(--text-body,13px)] leading-relaxed text-[var(--ink-muted)]", children: "Suite verifies each signed archive before it is used. A refusal names the app and leaves the rest of the setup alone." }), _jsx("div", { className: "mt-6", children: _jsx(InstallList, { packs: packs, rows: rows }) }), _jsxs("div", { className: "mt-6 flex flex-wrap gap-2", children: [_jsx(Button, { variant: "primary", onClick: onComplete, disabled: busy || rows.some((row) => row.state === "installing" || row.state === "queued"), children: "Continue to Home" }), rows.some((row) => row.state === "failed") ? (_jsx(Button, { variant: "secondary", onClick: () => void install(rows.filter((row) => row.state === "failed").map((row) => row.id)), children: "Retry failed" })) : null] })] })) : null] })] }));
}
//# sourceMappingURL=FirstRun.js.map