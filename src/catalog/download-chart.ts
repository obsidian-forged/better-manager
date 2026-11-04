import type { VersionDownloads } from "./catalog";

/** 分类版本轴，不伪造时间趋势 / Categorical version axis, not a historical time series. */
export function renderDownloadChart(container: HTMLElement, points: VersionDownloads[], label: string): void {
    const svg = container.createSvg("svg");
    svg.setAttribute("viewBox", "0 0 640 240");
    svg.setAttribute("width", "100%");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", label);
    const element = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>, value?: string) => {
        const node = svg.createSvg(tag, { attr: attrs });
        if (value !== undefined) node.textContent = value;
        return node;
    };
    const maximum = Math.max(1, ...points.map(point => point.downloads));
    const coordinates = points.map((point, i) => ({
        ...point, x: points.length === 1 ? 340 : 70 + i * 540 / (points.length - 1), y: 190 - point.downloads * 165 / maximum,
    }));
    element("path", { d: "M70 25V190H610", fill: "none", stroke: "currentColor" });
    element("text", { x: "60", y: "32", "text-anchor": "end", fill: "currentColor" }, maximum.toLocaleString());
    element("text", { x: "60", y: "190", "text-anchor": "end", fill: "currentColor" }, "0");
    element("polyline", { points: coordinates.map(point => `${point.x},${point.y}`).join(" "), fill: "none", stroke: "currentColor", "stroke-width": "2" });
    for (const point of coordinates) {
        const dot = element("circle", { cx: `${point.x}`, cy: `${point.y}`, r: "3", fill: "currentColor" });
        const title = dot.createSvg("title");
        title.textContent = `${point.version}: ${point.downloads.toLocaleString()}`;
    }
    if (points.length) {
        element("text", { x: "70", y: "220", fill: "currentColor" }, points[0].version.slice(0, 24));
        if (points.length > 1) element("text", { x: "610", y: "220", "text-anchor": "end", fill: "currentColor" }, points[points.length - 1].version.slice(0, 24));
    }
}
