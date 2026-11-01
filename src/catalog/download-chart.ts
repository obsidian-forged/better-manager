import type { VersionDownloads } from "./catalog";

/** 分类版本轴，不伪造时间趋势 / Categorical version axis, not a historical time series. */
export function renderDownloadChart(container: HTMLElement, points: VersionDownloads[], label: string): void {
    const namespace = "http://www.w3.org/2000/svg";
    const svg = container.ownerDocument.createElementNS(namespace, "svg");
    svg.setAttribute("viewBox", "0 0 640 240");
    svg.setAttribute("width", "100%");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", label);
    container.appendChild(svg);
    const element = (tag: string, attrs: Record<string, string>, value?: string) => {
        const node = container.ownerDocument.createElementNS(namespace, tag);
        for (const [key, val] of Object.entries(attrs)) node.setAttribute(key, val);
        if (value !== undefined) node.textContent = value;
        svg.appendChild(node);
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
        const title = container.ownerDocument.createElementNS(namespace, "title");
        title.textContent = `${point.version}: ${point.downloads.toLocaleString()}`;
        dot.appendChild(title);
    }
    if (points.length) {
        element("text", { x: "70", y: "220", fill: "currentColor" }, points[0].version.slice(0, 24));
        if (points.length > 1) element("text", { x: "610", y: "220", "text-anchor": "end", fill: "currentColor" }, points[points.length - 1].version.slice(0, 24));
    }
}
