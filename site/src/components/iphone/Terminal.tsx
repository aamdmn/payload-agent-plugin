import { motion } from "motion/react";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";

/*
 * Code Mode terminal. When the agent "thinks", this Mac-style window pops up next
 * to the phone (over the admin) and types out the real Code Mode trail — the
 * TypeScript the agent runs in a Node isolate, calling the plugin's external_*
 * tools (external_find / external_count / external_update) and composing them with
 * Promise.all and .map. It shows the power the chat hides: multi-step, parallel,
 * accurate, one shot. Holds with a blinking cursor, then the parent fades it out
 * organically when the next demo starts.
 */

export type TrailLine =
	| { kind: "code"; text: string }
	| { kind: "out"; text: string }
	| { kind: "ok"; text: string };

const CODE_CHAR_MS = 4;
const LINE_COMMIT_MS = 55;
const RESULT_REVEAL_MS = 240;
const STRING_RE = /("(?:[^"\\]|\\.)*")/g;
const TERMINAL_CSS = `
  @keyframes terminalCursorBlink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
  }
  [data-terminal-body]::-webkit-scrollbar { display: none; }
`;

const MONO_FONT =
	'"Geist Mono Variable", ui-monospace, SFMono-Regular, Menlo, monospace';

type TermPalette = {
	winBg: string;
	border: string;
	headBg: string;
	headBorder: string;
	code: string;
	string: string;
	comment: string;
	dim: string;
	title: string;
	accent: string;
	shadow: string;
};

function getTermPalette(isDark: boolean): TermPalette {
	if (isDark) {
		return {
			winBg: "#0d0d0f",
			border: "rgba(255,255,255,0.09)",
			headBg: "rgba(255,255,255,0.025)",
			headBorder: "rgba(255,255,255,0.06)",
			code: "rgba(255,255,255,0.9)",
			string: "rgba(255,255,255,0.6)",
			comment: "rgba(255,255,255,0.34)",
			dim: "rgba(255,255,255,0.42)",
			title: "rgba(255,255,255,0.5)",
			accent: "#5E9EFF",
			shadow:
				"0 30px 70px -22px rgba(0,0,0,0.7), 0 10px 26px rgba(0,0,0,0.4)",
		};
	}
	return {
		winBg: "#FCFCFD",
		border: "rgba(0,0,0,0.08)",
		headBg: "rgba(0,0,0,0.018)",
		headBorder: "rgba(0,0,0,0.06)",
		code: "rgba(0,0,0,0.85)",
		string: "rgba(0,0,0,0.52)",
		comment: "rgba(0,0,0,0.36)",
		dim: "rgba(0,0,0,0.42)",
		title: "rgba(0,0,0,0.45)",
		accent: "#0B5FFF",
		shadow:
			"0 30px 70px -25px rgba(0,0,0,0.3), 0 10px 26px rgba(0,0,0,0.12)",
	};
}

const OK_GREEN = "#34C759";

function TrafficLight({ color }: { color: string }) {
	return (
		<span
			style={{
				width: 11,
				height: 11,
				borderRadius: "50%",
				backgroundColor: color,
				display: "inline-block",
			}}
		/>
	);
}

function Cursor({ color }: { color: string }) {
	return (
		<span
			style={{
				display: "inline-block",
				width: 7,
				height: 14,
				marginLeft: 1,
				background: color,
				borderRadius: 1,
				verticalAlign: "text-bottom",
				animation: "terminalCursorBlink 1s step-end infinite",
			}}
		/>
	);
}

function CodeText({
	text,
	palette,
}: {
	text: string;
	palette: TermPalette;
}) {
	if (text.trimStart().startsWith("//")) {
		return <span style={{ color: palette.comment }}>{text}</span>;
	}

	// Dim string literals so the code reads structurally without hue (per the
	// site's monochrome code style); everything else stays the primary ink.
	const parts = text.split(STRING_RE);
	return (
		<span style={{ color: palette.code }}>
			{parts.map((part, i) =>
				i % 2 === 1 ? (
					// biome-ignore lint/suspicious/noArrayIndexKey: split output is positional
					<span key={i} style={{ color: palette.string }}>
						{part}
					</span>
				) : (
					// biome-ignore lint/suspicious/noArrayIndexKey: split output is positional
					<span key={i}>{part}</span>
				)
			)}
		</span>
	);
}

function TrailRow({
	line,
	palette,
	cursor,
}: {
	line: TrailLine;
	palette: TermPalette;
	cursor?: boolean;
}) {
	const base: CSSProperties = {
		whiteSpace: "pre",
		fontFamily: MONO_FONT,
		fontSize: 12.5,
		lineHeight: "20px",
		letterSpacing: "-0.01em",
	};

	if (line.kind === "out") {
		return (
			<div style={{ ...base, color: palette.dim }}>
				<span style={{ color: palette.accent }}>→ </span>
				{line.text}
			</div>
		);
	}

	if (line.kind === "ok") {
		return (
			<div style={{ ...base, color: palette.dim, display: "flex", alignItems: "center", gap: 6 }}>
				<svg
					width="12"
					height="12"
					viewBox="0 0 24 24"
					fill="none"
					stroke={OK_GREEN}
					strokeWidth="3.4"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					<path d="M20 6L9 17l-5-5" />
				</svg>
				{line.text}
			</div>
		);
	}

	return (
		<div style={base}>
			<CodeText text={line.text} palette={palette} />
			{cursor ? <Cursor color={palette.accent} /> : null}
		</div>
	);
}

export function Terminal({
	lines,
	isDark,
	title = "TanStack AI · code-mode",
	style,
}: {
	lines: TrailLine[];
	isDark: boolean;
	title?: string;
	style?: CSSProperties;
}) {
	const palette = getTermPalette(isDark);
	const [revealed, setRevealed] = useState(0);
	const [typed, setTyped] = useState(0);

	useEffect(() => {
		if (revealed >= lines.length) {
			return;
		}
		const active = lines[revealed];

		if (active.kind === "code") {
			if (typed < active.text.length) {
				const t = setTimeout(() => setTyped((n) => n + 1), CODE_CHAR_MS);
				return () => clearTimeout(t);
			}
			const t = setTimeout(() => {
				setRevealed((n) => n + 1);
				setTyped(0);
			}, LINE_COMMIT_MS);
			return () => clearTimeout(t);
		}

		const t = setTimeout(() => setRevealed((n) => n + 1), RESULT_REVEAL_MS);
		return () => clearTimeout(t);
	}, [revealed, typed, lines]);

	const done = revealed >= lines.length;
	const activeIsCode = !done && lines[revealed].kind === "code";

	return (
		<motion.div
			initial={{ opacity: 0, scale: 0.95, y: 12, filter: "blur(8px)" }}
			animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
			exit={{ opacity: 0, scale: 0.97, y: 6, filter: "blur(6px)" }}
			transition={{
				type: "spring",
				stiffness: 240,
				damping: 26,
				mass: 0.9,
			}}
			style={{
				width: 384,
				borderRadius: 13,
				background: palette.winBg,
				border: `1px solid ${palette.border}`,
				boxShadow: palette.shadow,
				overflow: "hidden",
				transformOrigin: "bottom right",
				...style,
			}}
		>
			<style>{TERMINAL_CSS}</style>

			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 8,
					padding: "10px 13px",
					background: palette.headBg,
					borderBottom: `1px solid ${palette.headBorder}`,
				}}
			>
				<div style={{ display: "flex", alignItems: "center", gap: 7 }}>
					<TrafficLight color="#FF5F57" />
					<TrafficLight color="#FEBC2E" />
					<TrafficLight color="#28C840" />
				</div>
				<span
					style={{
						marginLeft: 4,
						fontFamily: MONO_FONT,
						fontSize: 11.5,
						letterSpacing: "0.02em",
						color: palette.title,
					}}
				>
					{title}
				</span>
				<div
					style={{
						marginLeft: "auto",
						display: "flex",
						alignItems: "center",
						gap: 6,
						fontFamily: MONO_FONT,
						fontSize: 11,
						color: palette.dim,
					}}
				>
					<span
						style={{
							width: 6,
							height: 6,
							borderRadius: "50%",
							background: done ? OK_GREEN : palette.accent,
							boxShadow: done ? "none" : `0 0 6px ${palette.accent}`,
						}}
					/>
					{done ? "done" : "isolate"}
				</div>
			</div>

			<div
				data-terminal-body
				style={{
					height: 244,
					padding: "12px 14px",
					display: "flex",
					flexDirection: "column",
					justifyContent: "flex-end",
					gap: 1,
					overflow: "hidden",
				}}
			>
				{lines.slice(0, revealed).map((line, i) => (
					<TrailRow
						// biome-ignore lint/suspicious/noArrayIndexKey: trail is fixed and append-only
						key={i}
						line={line}
						palette={palette}
					/>
				))}
				{activeIsCode ? (
					<TrailRow
						line={{ kind: "code", text: lines[revealed].text.slice(0, typed) }}
						palette={palette}
						cursor
					/>
				) : null}
				{done ? (
					<div
						style={{
							fontFamily: MONO_FONT,
							fontSize: 12.5,
							lineHeight: "20px",
							color: palette.accent,
						}}
					>
						<Cursor color={palette.accent} />
					</div>
				) : null}
			</div>
		</motion.div>
	);
}
