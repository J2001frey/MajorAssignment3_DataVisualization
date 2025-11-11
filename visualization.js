const WIDTH = 1400;
const HEIGHT = 700;

// Setup D3 scales and colors
const colorScale = d3.scaleOrdinal(d3.schemeCategory10);

// D3 simulation variables
let simulation;
let chart;
let link, node;
let radiusScale;

// Get elements for controls and chart
const svg = d3.select("#chart")
    .attr("viewBox", [0, 0, WIDTH, HEIGHT]);

const tooltip = d3.select("#author-tooltip");

// --- 1. Load Data and Initiate Preparation ---
d3.csv("data_scopus.csv").then(rawData => {
    const forceData = prepareData(rawData);
    if (forceData) {
        console.log("--- Generated JSON Data Structure ---");
        console.log(JSON.stringify(forceData, null, 4));
        console.log("-------------------------------------");

        initializeVisualization(forceData);
    }
}).catch(error => {
    console.error("Error loading or processing data:", error);
    d3.select("#chart").append("text")
        .attr("x", WIDTH / 2)
        .attr("y", HEIGHT / 2)
        .attr("text-anchor", "middle")
        .attr("font-size", "24px")
        .text("Error loading data_scopus.csv. Check file path.");
});

// --- 2. Data Preparation Function (Core Logic) ---
function prepareData(rawData) {
    const filteredData = rawData.filter(d => 
        d.Year && d.Authors && d['Authors with affiliations']
    );

    if (filteredData.length === 0) {
        console.error("No data remaining after filtering missing records.");
        return null;
    }

    const allAuthorsInfo = new Map();
    const rawLinks = [];
    const countryCounts = new Map();

    filteredData.forEach(row => {
        const affiliationStr = row['Authors with affiliations'];
        const authorsInPaper = [];

        const authorBlocks = affiliationStr.split(';').map(s => s.trim()).filter(s => s.length > 0);

        authorBlocks.forEach(block => {
            const parts = block.split(',').map(p => p.trim()).filter(p => p.length > 0);
            
            if (parts.length >= 2) {
                const authorKey = `${parts[0]}, ${parts[1]}`;
                const country = parts[parts.length - 1];

                if (!allAuthorsInfo.has(authorKey)) {
                    allAuthorsInfo.set(authorKey, { country: country, co_authors: new Set() });
                }
                authorsInPaper.push(authorKey);
                
                countryCounts.set(country, (countryCounts.get(country) || 0) + 1);
            }
        });

        for (let i = 0; i < authorsInPaper.length; i++) {
            for (let j = i + 1; j < authorsInPaper.length; j++) {
                const source = authorsInPaper[i];
                const target = authorsInPaper[j];
                rawLinks.push({ source, target, EID: row.EID });
                
                allAuthorsInfo.get(source).co_authors.add(target);
                allAuthorsInfo.get(target).co_authors.add(source);
            }
        }
    });

    const sortedCountries = Array.from(countryCounts.entries())
        .sort((a, b) => b[1] - a[1]);
    const top10Countries = new Set(sortedCountries.slice(0, 10).map(d => d[0]));
    
    colorScale.domain(Array.from(top10Countries));

    const finalNodes = Array.from(allAuthorsInfo.entries()).map(([id, data]) => ({
        id: id,
        country: data.country,
        is_top_10: top10Countries.has(data.country),
        degree: data.co_authors.size
    }));

    const linkMap = new Map();

    rawLinks.forEach(link => {
        const key = [link.source, link.target].sort().join('|');
        if (!linkMap.has(key)) {
            linkMap.set(key, new Set());
        }
        linkMap.get(key).add(link.EID);
    });

    const finalLinks = Array.from(linkMap.entries()).map(([key, eids]) => {
        const [source, target] = key.split('|');
        return {
            source,
            target,
            shared_publications: eids.size
        };
    });

    return { nodes: finalNodes, links: finalLinks, top10Countries: Array.from(top10Countries) };
}

// --- 3. Initialize Visualization and Scales ---
function initializeVisualization(data) {
    setupLegend(data.top10Countries);

    const degrees = data.nodes.map(d => d.degree);
    const minDegree = d3.min(degrees);
    const maxDegree = d3.max(degrees);

    radiusScale = d3.scaleSqrt()
        .domain([minDegree, maxDegree])
        .range([3, 12]);
    
    chart = svg.append("g");

    const zoom = d3.zoom()
        .scaleExtent([0.1, 8])
        .on("zoom", (event) => {
            chart.attr("transform", event.transform);
        });
    svg.call(zoom);

    // --- 4. D3 Force Simulation Setup ---
    simulation = d3.forceSimulation(data.nodes)
        .force("link", d3.forceLink(data.links).id(d => d.id).distance(25).strength(parseFloat(d3.select("#link-slider").property("value"))))
        .force("charge", d3.forceManyBody().strength(parseFloat(d3.select("#charge-slider").property("value"))))
        .force("center", d3.forceCenter(WIDTH / 2, HEIGHT / 2))
        .force("x", d3.forceX(WIDTH / 2).strength(0.05))
        .force("y", d3.forceY(HEIGHT / 2).strength(0.05));
    
    simulation.force("collide", d3.forceCollide().radius(d => radiusScale(d.degree) * parseFloat(d3.select("#collide-slider").property("value"))));

    // --- 5. Draw Links and Nodes ---
    link = chart.append("g")
        .attr("class", "links")
        .selectAll("line")
        .data(data.links)
        .join("line")
        .attr("stroke-width", d => Math.sqrt(d.shared_publications))
        .attr("stroke", "#999")
        .attr("stroke-opacity", 0.6);

    node = chart.append("g")
        .attr("class", "nodes")
        .selectAll("circle")
        .data(data.nodes)
        .join("circle")
        .attr("class", "node")
        .attr("r", d => radiusScale(d.degree))
        .attr("fill", d => d.is_top_10 ? colorScale(d.country) : "#A9A9A9")
        .attr("stroke", "#fff")
        .attr("stroke-width", 1.5)
        .call(drag(simulation))
        .on("mouseover", handleMouseOver) // Modified
        .on("mouseout", handleMouseOut)   // Modified
        .on("click", handleClick);

    simulation.on("tick", () => {
        link
            .attr("x1", d => d.source.x)
            .attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x)
            .attr("y2", d => d.target.y);

        node
            .attr("cx", d => d.x)
            .attr("cy", d => d.y);
    });
    
    setupControls(simulation);
}

// --- 6. UI Interactions (MODIFIED) ---

/**
 * handleMouseOver: Highlights same-affiliation nodes AND displays tooltip with country/degree.
 */
function handleMouseOver(event, d) {
    const targetCountry = d.country;
    
    // 1. Highlighting Logic (Existing Requirement)
    node.attr("opacity", 0.2);
    link.attr("opacity", 0.05);

    node.filter(n => n.country === targetCountry)
        .attr("opacity", 1)
        .attr("stroke", "#333");
    
    link.filter(l => l.source.country === targetCountry && l.target.country === targetCountry)
        .attr("opacity", 0.6)
        .attr("stroke", "#000");

    // 2. Tooltip Display (New Requirement)
    tooltip.html(`
        <strong>Author:</strong> ${d.id}<br>
        <strong>Affiliation:</strong> ${d.country}<br>
        <strong>Co-authors (Degree):</strong> ${d.degree}
    `)
    .style("left", (event.pageX + 15) + "px")
    .style("top", (event.pageY - 30) + "px");

    tooltip.transition()
        .duration(100)
        .style("opacity", 0.9);
}

/**
 * handleMouseOut: Returns opacity to normal and hides tooltip.
 */
function handleMouseOut() {
    node.attr("opacity", 1).attr("stroke", "#fff");
    link.attr("opacity", 0.6).attr("stroke", "#999");
    
    // Hide the tooltip
    tooltip.transition().duration(200).style("opacity", 0);
}

/**
 * handleClick: Shows a persistent tooltip on click (Current logic is fine).
 */
function handleClick(event, d) {
    // Note: The tooltip content is already set by handleMouseOver, 
    // but we re-set it here and ensure it's visible, as the user might click outside the node later.
    tooltip.transition().duration(0).style("opacity", 0);
    
    tooltip.html(`
            <strong>Author:</strong> ${d.id}<br>
            <strong>Affiliation:</strong> ${d.country}<br>
            <strong>Co-authors (Degree):</strong> ${d.degree}
        `)
        .style("left", (event.pageX + 10) + "px")
        .style("top", (event.pageY - 28) + "px");
        
    tooltip.transition()
        .duration(200)
        .style("opacity", 0.9);
}

// D3 Dragging function (Unchanged)
const drag = simulation => {
    function dragstarted(event) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        event.subject.fx = event.subject.x;
        event.subject.fy = event.subject.y;
    }

    function dragged(event) {
        event.subject.fx = event.x;
        event.subject.fy = event.y;
    }

    function dragended(event) {
        if (!event.active) simulation.alphaTarget(0);
        event.subject.fx = null;
        event.subject.fy = null;
    }

    return d3.drag()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended);
};


// --- 7. UI Controls Setup (Unchanged) ---
function setupControls(simulation) {
    const chargeSlider = d3.select("#charge-slider");
    const collideSlider = d3.select("#collide-slider");
    const linkSlider = d3.select("#link-slider");
    
    chargeSlider.on("input", function() {
        const val = parseFloat(this.value);
        d3.select("#charge-value").text(val);
        simulation.force("charge").strength(val);
        simulation.alpha(1).restart();
    });

    collideSlider.on("input", function() {
        const factor = parseFloat(this.value);
        d3.select("#collide-value").text(factor);
        simulation.force("collide").radius(d => radiusScale(d.degree) * factor);
        simulation.alpha(1).restart();
    });
    
    linkSlider.on("input", function() {
        const val = parseFloat(this.value);
        d3.select("#link-value").text(val);
        simulation.force("link").strength(val);
        simulation.alpha(1).restart();
    });
}

// --- 8. Legend Setup (Unchanged) ---
function setupLegend(top10Countries) {
    const legendContainer = d3.select("#legend-container");
    
    top10Countries.forEach(country => {
        const color = colorScale(country);
        legendContainer.append("div")
            .attr("class", "legend-item")
            .html(`<span class="legend-color" style="background-color: ${color}; border: 1px solid #333;"></span>${country}`);
    });
}