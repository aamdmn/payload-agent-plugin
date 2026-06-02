import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChatIMessageAnimation, SCENARIOS } from "./ChatDemo";
import { IPhoneMock } from "./IPhoneMock";
import { Terminal } from "./Terminal";

/*
 * Island entry for the hero demo: the iPhone plus the Code Mode terminal. Scales
 * the fixed 418x890 device to fit the column, auto-cycles the scenarios, pauses
 * while scrolled out of view, mirrors the site light/dark theme, and—on wide
 * viewports—floats the terminal over the admin (tucked behind the phone's left
 * edge) while the agent runs Code Mode. Under prefers-reduced-motion it renders
 * the finished chat statically, with no terminal and no loop.
 */
const PHONE_W = 418;
const PHONE_H = 890;
const TERMINAL_TOP = 196;
const TERMINAL_GAP = 64; // px gap left of the phone — pushes the terminal toward the admin's center

function pickWidth(vw: number): number {
	if (vw < 480) {
		return Math.max(232, Math.min(vw - 56, 300));
	}
	if (vw < 1024) {
		return 312;
	}
	return 344;
}

function useDisplayWidth(): number {
	const [width, setWidth] = useState(344);

	useEffect(() => {
		const update = () => setWidth(pickWidth(window.innerWidth));
		update();
		window.addEventListener("resize", update);
		return () => window.removeEventListener("resize", update);
	}, []);

	return width;
}

function useMinWidth(px: number): boolean {
	const [match, setMatch] = useState(true);

	useEffect(() => {
		const mq = window.matchMedia(`(min-width: ${px}px)`);
		const update = () => setMatch(mq.matches);
		update();
		mq.addEventListener("change", update);
		return () => mq.removeEventListener("change", update);
	}, [px]);

	return match;
}

/* Mirror the site theme. The Nav toggle just flips documentElement's data-theme
 * (and localStorage); a MutationObserver on that attribute keeps the demo in sync. */
function useSiteIsDark(): boolean {
	const [isDark, setIsDark] = useState(true);

	useEffect(() => {
		const read = () =>
			setIsDark(document.documentElement.dataset.theme !== "light");
		read();
		const observer = new MutationObserver(read);
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["data-theme"],
		});
		return () => observer.disconnect();
	}, []);

	return isDark;
}

export default function PhoneShowcase() {
	const reduceMotion = useReducedMotion();
	const displayWidth = useDisplayWidth();
	const isDark = useSiteIsDark();
	const isWide = useMinWidth(1024);
	const scale = displayWidth / PHONE_W;

	const [index, setIndex] = useState(0);
	const [inView, setInView] = useState(true);
	const [codeActive, setCodeActive] = useState(false);
	const [codeIndex, setCodeIndex] = useState(0);
	const containerRef = useRef<HTMLDivElement>(null);
	const indexRef = useRef(0);
	indexRef.current = index;

	const handleComplete = useCallback(() => {
		setIndex((i) => (i + 1) % SCENARIOS.length);
	}, []);

	// The terminal only adopts the new scenario's trail once that scenario
	// actually starts running code, so it never flashes ahead of the phone.
	const handleCodeStart = useCallback(() => {
		setCodeIndex(indexRef.current);
		setCodeActive(true);
	}, []);

	const handleReset = useCallback(() => setCodeActive(false), []);

	useEffect(() => {
		const node = containerRef.current;
		if (!node || typeof IntersectionObserver === "undefined") {
			return;
		}

		const observer = new IntersectionObserver(
			([entry]) => setInView(entry.isIntersecting),
			{ threshold: 0.25 },
		);
		observer.observe(node);
		return () => observer.disconnect();
	}, []);

	const showTerminal = !reduceMotion && isWide;

	return (
		<motion.div
			ref={containerRef}
			initial={reduceMotion ? false : { opacity: 0, scale: 0.985, y: 8 }}
			animate={{ opacity: 1, scale: 1, y: 0 }}
			transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
			style={{
				width: Math.round(PHONE_W * scale),
				height: Math.round(PHONE_H * scale),
				position: "relative",
			}}
		>
			{showTerminal ? (
				<AnimatePresence>
					{codeActive ? (
						<Terminal
							key={codeIndex}
							lines={SCENARIOS[codeIndex].code}
							isDark={isDark}
							style={{
								position: "absolute",
								top: TERMINAL_TOP,
								right: `calc(100% + ${TERMINAL_GAP}px)`,
								zIndex: 1,
								pointerEvents: "none",
							}}
						/>
					) : null}
				</AnimatePresence>
			) : null}

			<div
				className="absolute left-0 top-0 origin-top-left"
				style={{ transform: `scale(${scale})`, zIndex: 2 }}
			>
				<IPhoneMock>
					{reduceMotion ? (
						<ChatIMessageAnimation
							scenario={SCENARIOS[0]}
							playing
							startAtEnd
							isDark={isDark}
						/>
					) : (
						<ChatIMessageAnimation
							key={index}
							scenario={SCENARIOS[index]}
							playing={inView}
							onComplete={handleComplete}
							onCodeStart={handleCodeStart}
							onReset={handleReset}
							isDark={isDark}
						/>
					)}
				</IPhoneMock>
			</div>
		</motion.div>
	);
}
