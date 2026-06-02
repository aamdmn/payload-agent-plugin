import { AnimatePresence, motion } from "motion/react";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { TrailLine } from "./Terminal";

/*
 * iMessage-style chat demo, ported from caltext's chat-demo with the meal-tracking
 * content swapped for the payload-agent story (manage Payload content from chat).
 * The look, timing curves, springs, blur entrances, keyboard slide, char-by-char
 * composer typing, send-button morph and read receipts are kept identical; the
 * scenario timeline is driven by a declarative step list (see SCENARIOS), and the
 * chat surface follows the site theme (light / dark) via the `isDark` prop.
 */

const SF_FONT =
	"-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif";
const SF_DISPLAY =
	"-apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif";
const LOCK_SCREEN_GRADIENT =
	"linear-gradient(165deg, #1c1f26 0%, #2b2f3a 32%, #3a3340 64%, #14141a 100%)";
const HIDE_SCROLLBAR_CSS = `
  [data-chat-scroll="true"]::-webkit-scrollbar {
    display: none;
  }

  @keyframes cursorBlink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
  }
`;
const MERIDIEM_RE = /\s?[APap][Mm]/;

const DEMO_DATE = new Date("2026-04-08T09:41:00");
const NOTIFICATION_APPEAR_MS = 100;
const LOCK_SCREEN_MS = 2300;
const NOTIFICATION_TAP_MS = 260;
const END_HOLD_MS = 3400;
const CHAR_TYPE_MS = 35;
const KEYBOARD_HEIGHT = 342;
const KEYBOARD_HIDDEN_OFFSET = 4;
const COMPOSER_INSET = 114;
const CHAT_START_MS = LOCK_SCREEN_MS + NOTIFICATION_TAP_MS;

function formatShortTime(date: Date): string {
	return date.toLocaleTimeString(undefined, {
		hour: "numeric",
		minute: "2-digit",
	});
}

function formatDemoClock(date: Date): string {
	return new Intl.DateTimeFormat(undefined, {
		hour: "numeric",
		minute: "2-digit",
	})
		.format(date)
		.replace(MERIDIEM_RE, "");
}

function formatDemoDate(date: Date): string {
	return new Intl.DateTimeFormat(undefined, {
		weekday: "long",
		month: "long",
		day: "numeric",
	}).format(date);
}

function useClientNow(): Date | null {
	const [now, setNow] = useState<Date | null>(null);

	useEffect(() => {
		const sync = () => {
			setNow(new Date());
		};

		sync();
		const intervalId = setInterval(sync, 60_000);

		return () => {
			clearInterval(intervalId);
		};
	}, []);

	return now;
}

/* Color sets for the chat surface in each theme. Lock screen + notification sit on
 * their own wallpaper and stay constant; only the conversation UI flips. */
type Palette = {
	chatBg: string;
	botBubble: string;
	botText: string;
	primaryText: string;
	subStrong: string;
	subWeak: string;
	placeholder: string;
	micColor: string;
	receipt: string;
	typingBubble: string;
	typingDot: string;
	composerFill: string;
	statusDark: boolean;
	glassDark: boolean;
	keyboardLight: boolean;
};

function getPalette(isDark: boolean): Palette {
	if (isDark) {
		return {
			chatBg: "#000000",
			botBubble: "#2C2C2E",
			botText: "#FFFFFF",
			primaryText: "#FFFFFF",
			subStrong: "rgba(255,255,255,0.62)",
			subWeak: "rgba(255,255,255,0.4)",
			placeholder: "#8E8E93",
			micColor: "rgba(255,255,255,0.58)",
			receipt: "rgba(255,255,255,0.38)",
			typingBubble: "#2C2C2E",
			typingDot: "#A1A1AA",
			composerFill:
				"linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.008))",
			statusDark: false,
			glassDark: true,
			keyboardLight: false,
		};
	}
	return {
		chatBg: "#FFFFFF",
		botBubble: "#E9E9EB",
		botText: "#000000",
		primaryText: "#000000",
		subStrong: "rgba(0,0,0,0.55)",
		subWeak: "rgba(0,0,0,0.42)",
		placeholder: "#8E8E93",
		micColor: "rgba(0,0,0,0.45)",
		receipt: "rgba(0,0,0,0.42)",
		typingBubble: "#E9E9EB",
		typingDot: "#8E8E93",
		composerFill:
			"linear-gradient(180deg, rgba(118,118,128,0.13), rgba(118,118,128,0.09))",
		statusDark: true,
		glassDark: false,
		keyboardLight: true,
	};
}

/* The Payload prism mark: a brighter front face + dimmer side face. */
function PayloadGlyph({ size = 20 }: { size?: number }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
		>
			<path d="M12 2L4 17L12 13.2Z" fill="#fff" />
			<path d="M12 2L20 17L12 13.2Z" fill="#fff" fillOpacity="0.55" />
		</svg>
	);
}

function AppIconSquare({ size = 38, borderRadius = 10 }: { size?: number; borderRadius?: number }) {
	const iconSize = Math.round(size * 0.56);
	return (
		<div
			style={{
				width: size,
				height: size,
				borderRadius,
				border: "1px solid rgba(255,255,255,0.08)",
				background: "linear-gradient(160deg, #303034 0%, #161618 100%)",
				boxShadow:
					"inset 0 1px 0 rgba(255,255,255,0.1), 0 8px 18px rgba(0,0,0,0.3)",
				flexShrink: 0,
				transform: "scaleX(1.044)",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
			}}
		>
			<PayloadGlyph size={iconSize} />
		</div>
	);
}

function ContactAvatar({ size = 56 }: { size?: number }) {
	return (
		<div
			className="flex items-center justify-center"
			style={{
				width: size,
				height: size,
				borderRadius: "50%",
				background:
					"radial-gradient(circle at 50% 24%, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.04) 28%, rgba(0,0,0,0) 52%), #000",
				boxShadow:
					"inset 0 1px 0 rgba(255,255,255,0.14), 0 10px 24px rgba(0,0,0,0.28)",
				transform: "scaleX(1.044)",
			}}
		>
			<PayloadGlyph size={Math.round(size * 0.44)} />
		</div>
	);
}

function HeaderBackIcon({ color }: { color: string }) {
	return (
		<svg
			width="10"
			height="17"
			viewBox="0 0 10 17"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
		>
			<path
				d="M7.95 1.8L1.95 8.5L7.95 15.2"
				stroke={color}
				strokeWidth="2.2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function HeaderVideoIcon({ color }: { color: string }) {
	return (
		<svg
			width="19"
			height="15"
			viewBox="0 0 19 15"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
		>
			<path
				d="M11.55 1.85H3.95C2.51 1.85 1.35 3.01 1.35 4.45V10.55C1.35 11.99 2.51 13.15 3.95 13.15H11.55C12.99 13.15 14.15 11.99 14.15 10.55V4.45C14.15 3.01 12.99 1.85 11.55 1.85Z"
				stroke={color}
				strokeWidth="1.9"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<path
				d="M14.15 5.6L17.45 3.9V11.1L14.15 9.4V5.6Z"
				stroke={color}
				strokeWidth="1.9"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function HeaderDisclosureIcon({ color }: { color: string }) {
	return (
		<svg
			width="8"
			height="13"
			viewBox="0 0 8 13"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
		>
			<path
				d="M2 1.5L6 6.5L2 11.5"
				stroke={color}
				strokeWidth="1.7"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function ComposerPlusIcon({ color }: { color: string }) {
	return (
		<svg
			width="15"
			height="15"
			viewBox="0 0 15 15"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
		>
			<path
				d="M7.5 3.2V11.8M3.2 7.5H11.8"
				stroke={color}
				strokeWidth="1.8"
				strokeLinecap="round"
			/>
		</svg>
	);
}

function ComposerMicIcon({ color }: { color: string }) {
	return (
		<svg
			width="12"
			height="16"
			viewBox="0 0 12 16"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
		>
			<path
				d="M6 10.2C7.546 10.2 8.8 8.946 8.8 7.4V4.2C8.8 2.654 7.546 1.4 6 1.4C4.454 1.4 3.2 2.654 3.2 4.2V7.4C3.2 8.946 4.454 10.2 6 10.2Z"
				stroke={color}
				strokeWidth="1.45"
			/>
			<path
				d="M10.4 7.2V7.45C10.4 9.88 8.43 11.85 6 11.85C3.57 11.85 1.6 9.88 1.6 7.45V7.2"
				stroke={color}
				strokeWidth="1.45"
				strokeLinecap="round"
			/>
			<path
				d="M6 11.85V15M3.6 15H8.4"
				stroke={color}
				strokeWidth="1.45"
				strokeLinecap="round"
			/>
		</svg>
	);
}

function ComposerSendIcon() {
	return (
		<svg
			width="26"
			height="26"
			viewBox="0 0 26 26"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
		>
			<circle cx="13" cy="13" r="13" fill="#007AFF" />
			<path
				d="M13 18.5V8.5M13 8.5L8.5 12.5M13 8.5L17.5 12.5"
				stroke="#FFFFFF"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function CheckIcon() {
	return (
		<svg
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			stroke="#34C759"
			strokeWidth="3"
			strokeLinecap="round"
			strokeLinejoin="round"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
			style={{ flexShrink: 0 }}
		>
			<path d="M20 6L9 17l-5-5" />
		</svg>
	);
}

/* Crisp status-bar glyphs: solid rounded signal bars, round-capped wifi arcs, and
 * a clean battery with terminal nub. `color` flips with the chat theme. */
function StatusSignalIcon({ color }: { color: string }) {
	return (
		<svg
			width="18"
			height="12"
			viewBox="0 0 18 12"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
		>
			<rect x="0" y="7.5" width="3" height="4.5" rx="1" fill={color} />
			<rect x="5" y="5" width="3" height="7" rx="1" fill={color} />
			<rect x="10" y="2.5" width="3" height="9.5" rx="1" fill={color} />
			<rect x="15" y="0" width="3" height="12" rx="1" fill={color} />
		</svg>
	);
}

function StatusWifiIcon({ color }: { color: string }) {
	return (
		<svg
			width="17"
			height="13"
			viewBox="0 0 17 13"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
		>
			<path
				d="M1.5 5.1Q8.5 0.3 15.5 5.1"
				stroke={color}
				strokeWidth="2"
				strokeLinecap="round"
			/>
			<path
				d="M4.1 7.7Q8.5 4.2 12.9 7.7"
				stroke={color}
				strokeWidth="2"
				strokeLinecap="round"
			/>
			<path
				d="M6.7 10.2Q8.5 8.7 10.3 10.2"
				stroke={color}
				strokeWidth="2"
				strokeLinecap="round"
			/>
		</svg>
	);
}

function StatusBatteryIcon({ color }: { color: string }) {
	return (
		<svg
			width="25"
			height="13"
			viewBox="0 0 25 13"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
		>
			<rect
				x="0.5"
				y="0.5"
				width="22"
				height="12"
				rx="3.4"
				stroke={color}
				strokeOpacity="0.4"
			/>
			<rect x="2" y="2" width="17.5" height="9" rx="2" fill={color} />
			<rect x="23.2" y="4.3" width="1.6" height="4.4" rx="0.8" fill={color} fillOpacity="0.4" />
		</svg>
	);
}

function LockFlashlightIcon({ color }: { color: string }) {
	return (
		<svg
			width="14"
			height="32"
			viewBox="0 0 14 32"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
		>
			<path
				opacity="0.9"
				d="M0 3.17871V2.79932C0 0.933105 0.912598 0 2.73779 0H10.6333C12.4585 0 13.3711 0.933105 13.3711 2.79932V3.17871H0ZM5.44482 31.6846C4.54932 31.6846 3.86914 31.4453 3.4043 30.9668C2.93945 30.4883 2.70703 29.791 2.70703 28.875V13.5044C2.70703 12.7866 2.63184 12.1782 2.48145 11.6792C2.33105 11.1733 2.12939 10.7222 1.87646 10.3257L1.10742 9.14648C0.786133 8.63379 0.519531 8.13135 0.307617 7.63916C0.102539 7.14014 0 6.58643 0 5.97803V4.92188H13.3711V5.97803C13.3711 6.58643 13.2651 7.14014 13.0532 7.63916C12.8481 8.13135 12.5815 8.63379 12.2534 9.14648L11.4946 10.3257C11.2417 10.7222 11.04 11.1733 10.8896 11.6792C10.7393 12.1782 10.6641 12.7866 10.6641 13.5044V28.875C10.6641 29.791 10.4282 30.4883 9.95654 30.9668C9.4917 31.4453 8.81494 31.6846 7.92627 31.6846H5.44482ZM4.25537 14.6733V18.8877C4.25537 19.5713 4.48779 20.1455 4.95264 20.6104C5.42432 21.0752 6.00537 21.3076 6.6958 21.3076C7.14697 21.3076 7.55371 21.2017 7.91602 20.9897C8.28516 20.7778 8.57568 20.4907 8.7876 20.1284C9.00635 19.7593 9.11572 19.3457 9.11572 18.8877V14.6733C9.11572 14.2222 9.00635 13.8154 8.7876 13.4531C8.57568 13.084 8.28516 12.7935 7.91602 12.5815C7.55371 12.3628 7.14697 12.2534 6.6958 12.2534C6.00537 12.2534 5.42432 12.4893 4.95264 12.9609C4.48779 13.4258 4.25537 13.9966 4.25537 14.6733ZM6.6958 20.4565C6.24463 20.4565 5.86865 20.3096 5.56787 20.0156C5.26709 19.7148 5.1167 19.3389 5.1167 18.8877C5.1167 18.457 5.26709 18.0913 5.56787 17.7905C5.87549 17.4829 6.25146 17.3291 6.6958 17.3291C7.12646 17.3291 7.49561 17.4829 7.80322 17.7905C8.11084 18.0913 8.26465 18.457 8.26465 18.8877C8.26465 19.3389 8.11426 19.7148 7.81348 20.0156C7.5127 20.3096 7.14014 20.4565 6.6958 20.4565Z"
				fill={color}
				style={{ mixBlendMode: "plus-lighter" }}
			/>
		</svg>
	);
}

function LockCameraIcon({ color }: { color: string }) {
	return (
		<svg
			width="33"
			height="26"
			viewBox="0 0 33 26"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
		>
			<path
				opacity="0.9"
				d="M27.3984 10.582C27.8906 10.582 28.3076 10.4111 28.6494 10.0693C28.998 9.7207 29.1724 9.30029 29.1724 8.80811C29.1724 8.32959 28.998 7.91602 28.6494 7.56738C28.3008 7.21875 27.8838 7.04443 27.3984 7.04443C26.9131 7.04443 26.4961 7.21875 26.1475 7.56738C25.7988 7.91602 25.6245 8.32959 25.6245 8.80811C25.6245 9.30029 25.7988 9.7207 26.1475 10.0693C26.4961 10.4111 26.9131 10.582 27.3984 10.582ZM4.51172 25.8296C3.04883 25.8296 1.93115 25.4468 1.15869 24.6812C0.38623 23.9155 0 22.8047 0 21.3486V7.42383C0 5.97461 0.38623 4.86719 1.15869 4.10156C1.93115 3.33594 3.04883 2.95312 4.51172 2.95312H7.71094C8.05273 2.95312 8.33301 2.93262 8.55176 2.8916C8.77734 2.84375 8.98242 2.76172 9.16699 2.64551C9.35156 2.52246 9.55664 2.34473 9.78223 2.1123L10.8281 1.0459C11.0742 0.799805 11.3237 0.601562 11.5767 0.451172C11.8364 0.300781 12.1235 0.187988 12.438 0.112793C12.7593 0.0375977 13.1387 0 13.5762 0H19.1748C19.6123 0 19.9917 0.0375977 20.313 0.112793C20.6343 0.187988 20.9214 0.300781 21.1743 0.451172C21.4272 0.601562 21.6733 0.799805 21.9126 1.0459L22.9585 2.1123C23.1909 2.34473 23.3994 2.52246 23.584 2.64551C23.7686 2.76172 23.9702 2.84375 24.189 2.8916C24.4146 2.93262 24.6982 2.95312 25.04 2.95312H28.3213C29.7773 2.95312 30.8916 3.33594 31.6641 4.10156C32.4365 4.86719 32.8228 5.97461 32.8228 7.42383V21.3486C32.8228 22.8047 32.4365 23.9155 31.6641 24.6812C30.8916 25.4468 29.7773 25.8296 28.3213 25.8296H4.51172ZM16.4165 21.4819C17.394 21.4819 18.3101 21.2974 19.1646 20.9282C20.019 20.5659 20.7676 20.0635 21.4102 19.4209C22.0596 18.7715 22.5654 18.0195 22.9277 17.165C23.2969 16.3037 23.4814 15.3809 23.4814 14.3965C23.4814 13.4121 23.3003 12.4927 22.938 11.6382C22.5757 10.7837 22.0698 10.0317 21.4204 9.38232C20.7778 8.73291 20.0259 8.22705 19.1646 7.86475C18.3101 7.49561 17.394 7.31104 16.4165 7.31104C15.439 7.31104 14.5195 7.49561 13.6582 7.86475C12.8037 8.22705 12.0518 8.73291 11.4023 9.38232C10.7598 10.0317 10.2573 10.7837 9.89502 11.6382C9.53271 12.4927 9.35156 13.4121 9.35156 14.3965C9.35156 15.3809 9.53271 16.3037 9.89502 17.165C10.2573 18.0195 10.7598 18.7715 11.4023 19.4209C12.0518 20.0635 12.8037 20.5659 13.6582 20.9282C14.5195 21.2974 15.439 21.4819 16.4165 21.4819ZM16.4165 18.7954C15.8081 18.7954 15.2373 18.6826 14.7041 18.457C14.1777 18.2246 13.7129 17.9102 13.3096 17.5137C12.9131 17.1104 12.5986 16.6421 12.3662 16.1089C12.1406 15.5757 12.0278 15.0049 12.0278 14.3965C12.0278 13.7881 12.1406 13.2173 12.3662 12.6841C12.5986 12.1509 12.9131 11.6826 13.3096 11.2793C13.7129 10.876 14.1777 10.5615 14.7041 10.3359C15.2373 10.1104 15.8081 9.99756 16.4165 9.99756C17.0249 9.99756 17.5923 10.1104 18.1187 10.3359C18.6519 10.5615 19.1167 10.876 19.5132 11.2793C19.9165 11.6826 20.231 12.1509 20.4565 12.6841C20.6821 13.2173 20.7949 13.7881 20.7949 14.3965C20.7949 15.0049 20.6821 15.5757 20.4565 16.1089C20.231 16.6421 19.9165 17.1104 19.5132 17.5137C19.1167 17.9102 18.6519 18.2246 18.1187 18.457C17.5923 18.6826 17.0249 18.7954 16.4165 18.7954Z"
				fill={color}
				style={{ mixBlendMode: "plus-lighter" }}
			/>
		</svg>
	);
}

function LiquidGlass({
	children,
	borderRadius,
	padding,
	className,
	style,
	dark = true,
}: {
	children: ReactNode;
	borderRadius: number | string;
	padding?: string;
	className?: string;
	style?: CSSProperties;
	dark?: boolean;
}) {
	return (
		<div
			className={className}
			style={{
				position: "relative",
				overflow: "hidden",
				borderRadius,
				padding,
				background: dark
					? "linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.025))"
					: "linear-gradient(180deg, rgba(120,120,128,0.18), rgba(120,120,128,0.12))",
				backdropFilter: "blur(14px) saturate(126%)",
				WebkitBackdropFilter: "blur(14px) saturate(126%)",
				boxShadow: dark
					? "inset 0 1px 0 rgba(255,255,255,0.1), inset 0 -1px 0 rgba(255,255,255,0.015), 0 6px 16px rgba(0,0,0,0.08)"
					: "inset 0 1px 0 rgba(255,255,255,0.55), inset 0 -1px 0 rgba(0,0,0,0.02), 0 4px 14px rgba(0,0,0,0.08)",
				...style,
			}}
		>
			<div
				aria-hidden="true"
				style={{
					position: "absolute",
					inset: 0,
					background:
						"linear-gradient(115deg, transparent 12%, rgba(255,255,255,0.12) 28%, rgba(255,255,255,0.04) 40%, transparent 58%)",
					mixBlendMode: "screen",
					opacity: dark ? 0.34 : 0.18,
					pointerEvents: "none",
				}}
			/>
			<div
				aria-hidden="true"
				style={{
					position: "absolute",
					inset: 0,
					background:
						"radial-gradient(circle at 20% 0%, rgba(255,255,255,0.1), transparent 34%), radial-gradient(circle at 80% 100%, rgba(255,255,255,0.035), transparent 28%)",
					opacity: dark ? 1 : 0.5,
					pointerEvents: "none",
				}}
			/>
			<div
				aria-hidden="true"
				style={{
					position: "absolute",
					inset: 0,
					borderRadius: "inherit",
					padding: "0.5px",
					background: dark
						? "linear-gradient(180deg, rgba(255,255,255,0.32), rgba(255,255,255,0.08))"
						: "linear-gradient(180deg, rgba(0,0,0,0.1), rgba(0,0,0,0.03))",
					WebkitMask:
						"linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
					WebkitMaskComposite: "xor",
					maskComposite: "exclude",
					pointerEvents: "none",
					opacity: 0.9,
				}}
			/>
			<div style={{ display: "contents" }}>{children}</div>
		</div>
	);
}

function StatusBar({ dark }: { dark?: boolean }) {
	const now = useClientNow();
	const color = dark ? "#000" : "#fff";

	return (
		<div
			className="absolute top-0 left-0 right-0 flex items-center justify-between"
			style={{ height: 54, padding: "14px 28px 0", zIndex: 20 }}
		>
			<span
				style={{
					color,
					fontSize: 17,
					fontWeight: 600,
					fontFamily: SF_FONT,
					letterSpacing: 0.2,
				}}
			>
				{now ? formatShortTime(now) : "9:41"}
			</span>

			<div className="flex items-center" style={{ gap: 7 }}>
				<StatusSignalIcon color={color} />
				<StatusWifiIcon color={color} />
				<StatusBatteryIcon color={color} />
			</div>
		</div>
	);
}

function HomeIndicator({ dark }: { dark?: boolean }) {
	return (
		<div
			className="absolute bottom-0 left-0 right-0 flex justify-center"
			style={{ paddingBottom: 8, zIndex: 20 }}
		>
			<div
				style={{
					width: 134,
					height: 5,
					borderRadius: 2.5,
					backgroundColor: dark ? "rgba(0,0,0,0.3)" : "rgba(255,255,255,0.5)",
				}}
			/>
		</div>
	);
}

function NotificationBanner({
	title,
	body,
	tapped,
}: {
	title: string;
	body: string;
	tapped: boolean;
}) {
	return (
		<motion.div
			initial={{ y: 300, opacity: 0, scale: 0.94, filter: "blur(10px)" }}
			animate={
				tapped
					? { y: -96, opacity: 0, scale: 0.96, filter: "blur(6px)" }
					: { y: 0, opacity: 1, scale: 1, filter: "blur(0px)" }
			}
			transition={
				tapped
					? { duration: 0.25, ease: "easeIn" }
					: { type: "spring", damping: 26, stiffness: 220, mass: 1.05 }
			}
			className="absolute"
			style={{
				bottom: 96,
				left: 16,
				right: 16,
				zIndex: 30,
			}}
		>
			<motion.div
				aria-hidden="true"
				initial={{ opacity: 0, y: 110, scale: 0.98 }}
				animate={
					tapped
						? { opacity: 0, y: 44, scale: 0.98 }
						: { opacity: 0.22, y: 340, scale: 1 }
				}
				transition={{ type: "spring", damping: 28, stiffness: 210 }}
				className="absolute left-0 right-0"
				style={{
					height: 64,
					borderRadius: 24,
					background:
						"linear-gradient(180deg, rgba(255,255,255,0.11), rgba(255,255,255,0.06))",
					backdropFilter: "blur(28px)",
					WebkitBackdropFilter: "blur(28px)",
					border: "1px solid rgba(255,255,255,0.12)",
					boxShadow:
						"inset 0 1px 0 rgba(255,255,255,0.18), 0 20px 40px rgba(0,0,0,0.12)",
				}}
			/>
			<motion.div
				aria-hidden="true"
				initial={{ opacity: 0, y: 165, scale: 0.96 }}
				animate={
					tapped
						? { opacity: 0, y: 72, scale: 0.96 }
						: { opacity: 0.14, y: 256, scale: 1 }
				}
				transition={{ type: "spring", damping: 28, stiffness: 210 }}
				className="absolute left-5 right-5"
				style={{
					height: 64,
					borderRadius: 24,
					background:
						"linear-gradient(180deg, rgba(255,255,255,0.1), rgba(255,255,255,0.05))",
					backdropFilter: "blur(28px)",
					WebkitBackdropFilter: "blur(28px)",
					border: "1px solid rgba(255,255,255,0.1)",
					boxShadow:
						"inset 0 1px 0 rgba(255,255,255,0.14), 0 18px 34px rgba(0,0,0,0.1)",
				}}
			/>

			<div
				className="relative flex items-start gap-3"
				style={{
					background:
						"linear-gradient(180deg, rgba(255,255,255,0.16), rgba(255,255,255,0.1))",
					backdropFilter: "blur(40px)",
					WebkitBackdropFilter: "blur(40px)",
					borderRadius: 24,
					padding: "12px 14px",
					border: "1px solid rgba(255, 255, 255, 0.2)",
					boxShadow:
						"inset 0 1px 0 rgba(255,255,255,0.25), 0 8px 32px rgba(0,0,0,0.15)",
				}}
			>
				<AppIconSquare />

				<div className="min-w-0 flex-1">
					<div className="flex items-center justify-between">
						<span
							style={{
								fontSize: 13.5,
								fontWeight: 600,
								color: "rgba(255,255,255,0.9)",
								fontFamily: SF_FONT,
							}}
						>
							{title}
						</span>
						<span
							style={{
								fontSize: 12,
								color: "rgba(255,255,255,0.45)",
								fontFamily: SF_FONT,
							}}
						>
							now
						</span>
					</div>
					<p
						className="mt-0.5"
						style={{
							fontSize: 13.5,
							lineHeight: 1.35,
							color: "rgba(255,255,255,0.75)",
							fontFamily: SF_FONT,
							display: "-webkit-box",
							WebkitLineClamp: 3,
							WebkitBoxOrient: "vertical",
							overflow: "hidden",
						}}
					>
						{body}
					</p>
				</div>
			</div>
		</motion.div>
	);
}

function LockScreen({ currentDate }: { currentDate: Date }) {
	const dateStr = useMemo(() => formatDemoDate(currentDate), [currentDate]);
	const timeStr = useMemo(() => formatDemoClock(currentDate), [currentDate]);
	return (
		<motion.div
			className="absolute inset-0 flex flex-col items-center"
			initial={{ opacity: 0 }}
			animate={{ opacity: 1 }}
			transition={{ duration: 0.5, ease: "easeOut" }}
		>
			<div
				className="absolute inset-0"
				style={{
					background: LOCK_SCREEN_GRADIENT,
					zIndex: 0,
				}}
			/>
			<div
				className="absolute inset-0"
				style={{ background: "rgba(255,255,255,0.02)", zIndex: 1 }}
			/>

			<StatusBar />
			<HomeIndicator />

			<div
				style={{
					marginTop: 72,
					zIndex: 10,
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
				}}
			>
				<div
					style={{
						fontSize: 21,
						fontWeight: 600,
						color: "rgba(255,255,255,0.94)",
						fontFamily: SF_FONT,
						letterSpacing: -0.35,
						marginBottom: 10,
						textShadow: "0 1px 10px rgba(255,255,255,0.08)",
					}}
				>
					{dateStr}
				</div>

				<div
					style={{
						fontSize: 148,
						fontWeight: 560,
						fontFamily: SF_DISPLAY,
						lineHeight: 0.88,
						letterSpacing: -6,
						color: "rgba(255,255,255,0.96)",
						textShadow: "0 1px 20px rgba(255,255,255,0.08)",
					}}
				>
					{timeStr}
				</div>
			</div>

			<div
				className="absolute flex items-center justify-between"
				style={{
					bottom: 24,
					left: 48,
					right: 48,
					zIndex: 10,
				}}
			>
				<LiquidGlass
					borderRadius="50%"
					className="flex items-center justify-center"
					style={{ width: 48, height: 48, transform: "scaleX(1.044)" }}
				>
					<div
						className="flex items-center justify-center"
						style={{ transform: "scale(0.64)" }}
					>
						<LockFlashlightIcon color="rgba(255,255,255,0.94)" />
					</div>
				</LiquidGlass>

				<LiquidGlass
					borderRadius="50%"
					className="flex items-center justify-center"
					style={{ width: 48, height: 48, transform: "scaleX(1.044)" }}
				>
					<div
						className="flex items-center justify-center"
						style={{ transform: "scale(0.48)" }}
					>
						<LockCameraIcon color="rgba(255,255,255,0.94)" />
					</div>
				</LiquidGlass>
			</div>
		</motion.div>
	);
}

function MessageBubble({
	message,
	palette,
}: {
	message: ChatMessage;
	palette: Palette;
}) {
	const isUser = message.sender === "user";
	const bubbleBackground = isUser ? "#007AFF" : palette.botBubble;

	return (
		<div
			className={`flex ${isUser ? "justify-end" : "justify-start"}`}
			style={{ padding: "2px 8px" }}
		>
			<div style={{ maxWidth: "84%" }}>
				<div
					style={{
						position: "relative",
						overflow: "visible",
						padding: "10px 15px",
						fontSize: 17,
						lineHeight: 1.22,
						color: isUser ? "#FFFFFF" : palette.botText,
						backgroundColor: bubbleBackground,
						borderRadius: isUser
							? "20px 20px 6px 20px"
							: "20px 20px 20px 6px",
						fontFamily: SF_FONT,
						whiteSpace: "pre-line",
						display: message.trailingCheck ? "flex" : "block",
						alignItems: message.trailingCheck ? "center" : undefined,
						gap: message.trailingCheck ? 7 : undefined,
					}}
				>
					{message.text ? <span>{message.text}</span> : null}
					{message.trailingCheck ? <CheckIcon /> : null}
				</div>
				{isUser ? (
					<div
						style={{
							height: 16,
							marginTop: 5,
							paddingRight: 2,
							position: "relative",
							overflow: "hidden",
						}}
					>
						<AnimatePresence initial={false}>
							{message.statusLabel ? (
								<motion.div
									key={`receipt-${message.id}-${message.statusLabel}`}
									initial={{ opacity: 0, y: -3, filter: "blur(4px)" }}
									animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
									exit={{ opacity: 0, y: -2, filter: "blur(3px)" }}
									transition={{
										duration: 0.22,
										ease: [0.22, 1, 0.36, 1],
									}}
									style={{
										position: "absolute",
										top: 0,
										right: 4,
										textAlign: "right",
										fontSize: 12,
										lineHeight: 1,
										fontWeight: 500,
										color: palette.receipt,
										fontFamily: SF_FONT,
										letterSpacing: -0.1,
										willChange: "transform, opacity, filter",
									}}
								>
									{message.statusLabel}
								</motion.div>
							) : null}
						</AnimatePresence>
					</div>
				) : null}
			</div>
		</div>
	);
}

function TypingIndicator({ palette }: { palette: Palette }) {
	return (
		<div className="flex items-start" style={{ padding: "4px 16px" }}>
			<div
				className="flex items-center gap-1"
				style={{
					background: palette.typingBubble,
					borderRadius: "18px 18px 18px 4px",
					padding: "10px 14px",
					height: 36,
				}}
			>
				{[0, 1, 2].map((i) => (
					<motion.div
						key={i}
						style={{
							width: 7,
							height: 7,
							borderRadius: "50%",
							backgroundColor: palette.typingDot,
						}}
						animate={{ y: [0, -4, 0] }}
						transition={{
							duration: 0.6,
							repeat: Number.POSITIVE_INFINITY,
							delay: i * 0.15,
							ease: "easeInOut",
						}}
					/>
				))}
			</div>
		</div>
	);
}

function IOSKeyboard({ light }: { light?: boolean }) {
	return (
		<img
			src="/ios-keyboard-dark.svg"
			alt=""
			draggable={false}
			style={{
				width: "100%",
				display: "block",
				filter: light ? "invert(1) hue-rotate(180deg)" : "none",
			}}
		/>
	);
}

function ChatView({
	title,
	messages,
	composerText,
	isTyping,
	showKeyboard,
	isDark,
}: {
	title: string;
	messages: ChatMessage[];
	composerText: string;
	isTyping: boolean;
	showKeyboard: boolean;
	isDark: boolean;
}) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const [typedLength, setTypedLength] = useState(0);
	const composerTextRef = useRef(composerText);
	const visibleBottomInset = showKeyboard ? KEYBOARD_HEIGHT + 52 : COMPOSER_INSET;
	const palette = getPalette(isDark);

	useEffect(() => {
		if (composerText !== composerTextRef.current) {
			composerTextRef.current = composerText;
			setTypedLength(0);
		}
		if (!composerText) {
			return;
		}
		if (typedLength >= composerText.length) {
			return;
		}

		const timer = setTimeout(() => {
			setTypedLength((prev) => prev + 1);
		}, CHAR_TYPE_MS);

		return () => clearTimeout(timer);
	}, [composerText, typedLength]);

	// Re-pin to the latest message / typing bubble as content grows, and when the
	// keyboard raises the bottom inset. The short rAF loop rides out the layout spring.
	useEffect(() => {
		const el = scrollRef.current;
		if (!el) {
			return;
		}
		let raf: number;
		let count = 0;
		const scroll = () => {
			el.scrollTop = el.scrollHeight;
			count++;
			if (count < 20) {
				raf = requestAnimationFrame(scroll);
			}
		};
		raf = requestAnimationFrame(scroll);
		return () => cancelAnimationFrame(raf);
	}, [messages.length, isTyping, showKeyboard]);

	const visibleComposerText = composerText
		? composerText.slice(0, typedLength)
		: "";
	const showSendButton = composerText.length > 0 && typedLength > 0;

	return (
		<div
			className="absolute inset-0 flex flex-col"
			style={{
				background: palette.chatBg,
				color: palette.primaryText,
				overflow: "hidden",
			}}
		>
			<StatusBar dark={palette.statusDark} />

			<div
				className="relative"
				style={{
					marginTop: 52,
					padding: "6px 14px 12px",
					background: palette.chatBg,
				}}
			>
				<div className="flex items-center justify-between">
					<button
						type="button"
						className="flex items-center justify-center"
						style={{
							width: 36,
							height: 36,
							background: "transparent",
							border: "none",
							padding: 0,
						}}
					>
						<LiquidGlass
							borderRadius="50%"
							className="flex items-center justify-center"
							style={{ width: 36, height: 36 }}
							dark={isDark}
						>
							<HeaderBackIcon color={palette.primaryText} />
						</LiquidGlass>
					</button>

					<div
						className="flex items-center justify-center"
						style={{ width: 36, minWidth: 36 }}
					>
						<LiquidGlass
							borderRadius="50%"
							className="flex items-center justify-center"
							style={{ width: 36, height: 36 }}
							dark={isDark}
						>
							<HeaderVideoIcon color={palette.primaryText} />
						</LiquidGlass>
					</div>
				</div>

				<div className="flex flex-col items-center" style={{ marginTop: -30 }}>
					<div style={{ display: "inline-flex" }}>
						<ContactAvatar size={56} />
					</div>

					<LiquidGlass
						borderRadius={16}
						dark={isDark}
						style={{
							marginTop: -4,
							minHeight: 30,
							padding: "0 12px",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							gap: 6,
						}}
					>
						<span
							style={{
								fontSize: 15,
								fontWeight: 700,
								color: palette.primaryText,
								fontFamily: SF_FONT,
								letterSpacing: -0.2,
							}}
						>
							{title}
						</span>
						<HeaderDisclosureIcon color={palette.subWeak} />
					</LiquidGlass>

					<div
						style={{
							marginTop: 10,
							fontSize: 14,
							fontWeight: 400,
							color: palette.subStrong,
							fontFamily: SF_FONT,
							lineHeight: 1.2,
						}}
					>
						iMessage
					</div>
					<div
						className="flex items-center gap-1"
						style={{
							marginTop: 2,
							fontSize: 12,
							fontWeight: 400,
							color: palette.subWeak,
							fontFamily: SF_FONT,
							lineHeight: 1,
						}}
					>
						<svg
							width="8"
							height="10"
							viewBox="0 0 8 10"
							fill="none"
							xmlns="http://www.w3.org/2000/svg"
							aria-hidden="true"
						>
							<rect
								x="1.4"
								y="4.3"
								width="5.2"
								height="4.3"
								rx="1.1"
								fill={palette.subWeak}
							/>
							<path
								d="M2.4 4.3V3.3C2.4 2.24 3.11 1.4 4 1.4C4.89 1.4 5.6 2.24 5.6 3.3V4.3"
								stroke={palette.subWeak}
								strokeWidth="1"
								strokeLinecap="round"
							/>
						</svg>
						<span>Encrypted</span>
					</div>
				</div>
			</div>

			<motion.div
				layout
				ref={scrollRef}
				className="flex-1 overflow-y-auto"
				data-chat-scroll="true"
				animate={{
					paddingTop: 6,
					paddingBottom: visibleBottomInset,
				}}
				transition={{
					type: "spring",
					stiffness: 380,
					damping: 34,
					mass: 0.92,
				}}
				style={{
					background: palette.chatBg,
					scrollbarWidth: "none",
					msOverflowStyle: "none",
					WebkitOverflowScrolling: "touch",
					overscrollBehaviorY: "contain",
					touchAction: "pan-y",
				}}
			>
				<div className="flex flex-col gap-1">
					<AnimatePresence mode="popLayout">
						{messages.map((msg) => (
							<motion.div
								key={msg.id}
								initial={{ opacity: 0, y: 10, filter: "blur(6px)" }}
								animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
								exit={{ opacity: 0 }}
								transition={{ duration: 0.22, ease: "easeOut" }}
							>
								<MessageBubble message={msg} palette={palette} />
							</motion.div>
						))}
					</AnimatePresence>
					{isTyping ? <TypingIndicator palette={palette} /> : null}
				</div>
			</motion.div>

			<motion.div
				className="absolute left-0 right-0 bottom-0"
				initial={{ y: KEYBOARD_HEIGHT + KEYBOARD_HIDDEN_OFFSET }}
				animate={{
					y: showKeyboard ? 0 : KEYBOARD_HEIGHT + KEYBOARD_HIDDEN_OFFSET,
				}}
				transition={
					showKeyboard
						? {
								type: "spring",
								stiffness: 390,
								damping: 34,
								mass: 0.92,
							}
						: { duration: 0 }
				}
				style={{
					zIndex: 20,
					willChange: "transform",
				}}
			>
				<div
					className="flex items-center gap-[8px]"
					style={{
						width: "calc(100% - 20px)",
						margin: "0 auto",
						padding: "12px 16px 22px",
						background: "transparent",
					}}
				>
					<LiquidGlass
						borderRadius="50%"
						className="flex items-center justify-center"
						dark={isDark}
						style={{
							width: 36,
							height: 36,
						}}
					>
						<ComposerPlusIcon color={palette.primaryText} />
					</LiquidGlass>

					<div className="flex-1" style={{ minWidth: 0 }}>
						<LiquidGlass
							borderRadius={18}
							className="flex-1"
							dark={isDark}
							style={{
								width: "100%",
								height: 36,
								background: palette.composerFill,
								display: "flex",
								alignItems: "center",
								gap: 8,
								paddingLeft: 15,
								paddingRight: 10,
								minWidth: 0,
							}}
						>
							{visibleComposerText ? (
								<span
									style={{
										flex: 1,
										minWidth: 0,
										display: "block",
										fontSize: 16,
										color: palette.primaryText,
										fontFamily: SF_FONT,
										letterSpacing: -0.2,
										whiteSpace: "nowrap",
										overflow: "hidden",
										direction: "rtl",
										textAlign: "left",
									}}
								>
									<span
										style={{
											display: "inline-flex",
											alignItems: "flex-end",
											whiteSpace: "nowrap",
											flexShrink: 0,
											direction: "ltr",
										}}
									>
										{visibleComposerText}
										<span
											style={{
												display: "inline-block",
												width: 2,
												height: 18,
												marginLeft: 1,
												background: "#007AFF",
												verticalAlign: "text-bottom",
												animation: "cursorBlink 1s step-end infinite",
												flexShrink: 0,
											}}
										/>
									</span>
								</span>
							) : (
								<span
									style={{
										flex: 1,
										minWidth: 0,
										fontSize: 16,
										color: palette.placeholder,
										fontFamily: SF_FONT,
										letterSpacing: -0.2,
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
									}}
								>
									iMessage
								</span>
							)}
							<div
								className="flex items-center justify-center"
								style={{
									width: showSendButton ? 26 : 17,
									height: showSendButton ? 26 : 17,
									transition: "all 0.15s ease",
									flexShrink: 0,
								}}
							>
								{showSendButton ? (
									<ComposerSendIcon />
								) : (
									<ComposerMicIcon color={palette.micColor} />
								)}
							</div>
						</LiquidGlass>
					</div>
				</div>

				<IOSKeyboard light={palette.keyboardLight} />
			</motion.div>
		</div>
	);
}

type ChatMessage = {
	id: number;
	sender: "user" | "assistant";
	text: string;
	trailingCheck?: boolean;
	statusLabel?: string;
};

type ScenarioStep =
	| {
			kind: "bot";
			text: string;
			trailingCheck?: boolean;
			typing?: boolean;
			thinkMs?: number;
			gapMs?: number;
			/** Marks the step whose "thinking" is the agent running Code Mode. */
			runsCode?: boolean;
		}
	| { kind: "user"; text: string; gapMs?: number };

export type Scenario = {
	id: string;
	title: string;
	notificationTitle: string;
	notificationBody: string;
	steps: ScenarioStep[];
	/** The Code Mode trail shown in the terminal while the agent works. */
	code: TrailLine[];
};

export const SCENARIOS: Scenario[] = [
	{
		id: "build",
		title: "payload-agent",
		notificationTitle: "payload-agent",
		notificationBody: "The Home page is missing its Stats block.",
		steps: [
			{
				kind: "bot",
				text: "Want me to fill it in? I can pull live numbers straight from your collections.",
				typing: false,
			},
			{
				kind: "user",
				text: "Fill the Stats block, then translate the whole page to Slovak.",
			},
			{
				kind: "bot",
				text: "Done — Stats block filled from live counts, published in English + Slovak.",
				trailingCheck: true,
				runsCode: true,
				thinkMs: 4600,
				gapMs: 900,
			},
		],
		code: [
			{ kind: "code", text: "const { docs } = await external_find({" },
			{ kind: "code", text: '  collection: "pages", where: { slug: "home" },' },
			{ kind: "code", text: "})" },
			{ kind: "out", text: '1 doc · "Home"' },
			{ kind: "code", text: "// live numbers, in parallel" },
			{
				kind: "code",
				text: "const [users, orders] = await Promise.all([",
			},
			{ kind: "code", text: '  external_count({ collection: "users" }),' },
			{ kind: "code", text: '  external_count({ collection: "orders" }),' },
			{ kind: "code", text: "])" },
			{ kind: "out", text: "1 284 · 9 480" },
			{ kind: "code", text: 'await external_update({ collection: "pages",' },
			{
				kind: "code",
				text: "  id: docs[0].id, data: { layout: withStats(...) } })",
			},
			{ kind: "ok", text: "stats block filled" },
			{ kind: "code", text: "// translate every localized field → sk" },
			{
				kind: "code",
				text: 'await external_update({ ...home, locale: "sk", data: sk })',
			},
			{ kind: "ok", text: "published · en + sk" },
		],
	},
	{
		id: "restock",
		title: "payload-agent",
		notificationTitle: "payload-agent",
		notificationBody: "3 products just dropped below 10 in stock.",
		steps: [
			{
				kind: "bot",
				text: "3 products are low on stock. Want me to bump them back up?",
				typing: false,
			},
			{ kind: "user", text: "Yes, set each to 50." },
			{
				kind: "bot",
				text: "Done — all 3 restocked to 50 units.",
				trailingCheck: true,
				runsCode: true,
				thinkMs: 2900,
				gapMs: 900,
			},
		],
		code: [
			{ kind: "code", text: "const low = await external_find({" },
			{ kind: "code", text: '  collection: "products",' },
			{ kind: "code", text: "  where: { stock: { less_than: 10 } }," },
			{ kind: "code", text: "})" },
			{ kind: "out", text: "3 docs · Tee, Cap, Tote" },
			{ kind: "code", text: "await Promise.all(low.docs.map((p) =>" },
			{ kind: "code", text: '  external_update({ collection: "products",' },
			{ kind: "code", text: "    id: p.id, data: { stock: 50 } })))" },
			{ kind: "ok", text: "3 updated · stock → 50" },
		],
	},
];

export function ChatIMessageAnimation({
	scenario,
	playing,
	startAtEnd = false,
	onComplete,
	onCodeStart,
	onReset,
	isDark = true,
}: {
	scenario: Scenario;
	playing: boolean;
	startAtEnd?: boolean;
	onComplete?: () => void;
	/** Fired when the agent starts running Code Mode (terminal should appear). */
	onCodeStart?: () => void;
	/** Fired when a fresh play (re)starts at the lock screen (terminal hides). */
	onReset?: () => void;
	isDark?: boolean;
}) {
	const clientNow = useClientNow();
	const [phase, setPhase] = useState<"lock" | "chat">("lock");
	const [visibleMessages, setVisibleMessages] = useState(0);
	const [notificationVisible, setNotificationVisible] = useState(false);
	const [notificationTapped, setNotificationTapped] = useState(false);
	const [composerDraft, setComposerDraft] = useState("");
	const [isTyping, setIsTyping] = useState(false);
	const [showKeyboard, setShowKeyboard] = useState(false);
	const [receipts, setReceipts] = useState<Record<number, string>>({});
	const [referenceDate, setReferenceDate] = useState<Date | null>(null);
	const doneRef = useRef(false);

	useEffect(() => {
		if (clientNow !== null && referenceDate === null) {
			setReferenceDate(clientNow);
		}
	}, [clientNow, referenceDate]);

	const activeDate = referenceDate ?? DEMO_DATE;

	const messages = useMemo<ChatMessage[]>(
		() =>
			scenario.steps.map((step, i) => ({
				id: i + 1,
				sender: step.kind === "user" ? "user" : "assistant",
				text: step.text,
				trailingCheck: step.kind === "bot" ? step.trailingCheck : undefined,
			})),
		[scenario],
	);

	useEffect(() => {
		doneRef.current = false;

		const reset = () => {
			setVisibleMessages(0);
			setNotificationVisible(false);
			setNotificationTapped(false);
			setComposerDraft("");
			setIsTyping(false);
			setShowKeyboard(false);
			setReceipts({});
		};

		if (!playing) {
			setPhase("lock");
			reset();
			onReset?.();
			return;
		}

		const timers: Array<ReturnType<typeof setTimeout>> = [];
		const at = (ms: number, fn: () => void) => {
			timers.push(setTimeout(fn, ms));
		};

		if (startAtEnd) {
			setPhase("chat");
			setVisibleMessages(scenario.steps.length);
			setNotificationVisible(false);
			setNotificationTapped(true);
			setComposerDraft("");
			setIsTyping(false);
			setShowKeyboard(false);
			const finalReceipts: Record<number, string> = {};
			scenario.steps.forEach((step, i) => {
				if (step.kind === "user") {
					finalReceipts[i + 1] = "Read";
				}
			});
			setReceipts(finalReceipts);
			return () => {
				timers.forEach(clearTimeout);
			};
		}

		setPhase("lock");
		reset();
		onReset?.();

		at(NOTIFICATION_APPEAR_MS, () => setNotificationVisible(true));
		at(LOCK_SCREEN_MS, () => setNotificationTapped(true));
		at(CHAT_START_MS, () => setPhase("chat"));

		let cursor = CHAT_START_MS;
		let lastUserId: number | null = null;

		scenario.steps.forEach((step, i) => {
			const reveal = i + 1;
			const prev = scenario.steps[i - 1];

			if (step.kind === "user") {
				const id = reveal;
				const gap = step.gapMs ?? 1400;
				const text = step.text;

				cursor += gap;
				at(cursor, () => setShowKeyboard(true));
				cursor += 400;
				at(cursor, () => setComposerDraft(text));
				cursor += text.length * CHAR_TYPE_MS + 400;
				at(cursor, () => {
					setComposerDraft("");
					setShowKeyboard(false);
					setVisibleMessages(reveal);
					setReceipts((r) => ({ ...r, [id]: "Delivered" }));
				});
				lastUserId = id;
			} else {
				const isFirst = i === 0;
				const afterUser = prev?.kind === "user";
				const useTyping = step.typing ?? !isFirst;
				const gap = step.gapMs ?? (isFirst ? 300 : afterUser ? 1000 : 1200);
				const userId = lastUserId;
				const fireCode = step.runsCode === true;

				cursor += gap;

				if (useTyping) {
					const think = step.thinkMs ?? (afterUser ? 2200 : 1400);
					at(cursor, () => {
						setIsTyping(true);
						if (fireCode) {
							onCodeStart?.();
						}
						if (userId !== null) {
							setReceipts((r) => ({ ...r, [userId]: "Read" }));
						}
					});
					cursor += think;
					at(cursor, () => {
						setIsTyping(false);
						setVisibleMessages(reveal);
					});
				} else {
					at(cursor, () => setVisibleMessages(reveal));
				}
			}
		});

		cursor += END_HOLD_MS;
		at(cursor, () => {
			if (!doneRef.current) {
				doneRef.current = true;
				onComplete?.();
			}
		});

		return () => {
			timers.forEach(clearTimeout);
		};
	}, [scenario, playing, startAtEnd, onComplete, onCodeStart, onReset]);

	const visible = useMemo(
		() =>
			messages
				.slice(0, visibleMessages)
				.map((m) => ({ ...m, statusLabel: receipts[m.id] })),
		[messages, visibleMessages, receipts],
	);

	return (
		<div
			className="relative h-full w-full overflow-hidden"
			style={{ background: isDark ? "#000000" : "#FFFFFF" }}
		>
			<style>{HIDE_SCROLLBAR_CSS}</style>

			<AnimatePresence mode="wait">
				{phase === "lock" ? (
					<motion.div
						key={`${scenario.id}-lock`}
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0, scale: 1.015, filter: "blur(8px)" }}
						transition={{ duration: 0.35, ease: "easeOut" }}
						className="absolute inset-0"
					>
						<LockScreen currentDate={activeDate} />
						{notificationVisible ? (
							<NotificationBanner
								title={scenario.notificationTitle}
								body={scenario.notificationBody}
								tapped={notificationTapped}
							/>
						) : null}
					</motion.div>
				) : (
					<motion.div
						key={`${scenario.id}-chat`}
						initial={{ opacity: 0, y: 8 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0 }}
						transition={{ duration: 0.3, ease: "easeOut" }}
						className="absolute inset-0"
					>
						<ChatView
							title={scenario.title}
							messages={visible}
							composerText={composerDraft}
							isTyping={isTyping}
							showKeyboard={showKeyboard}
							isDark={isDark}
						/>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}
