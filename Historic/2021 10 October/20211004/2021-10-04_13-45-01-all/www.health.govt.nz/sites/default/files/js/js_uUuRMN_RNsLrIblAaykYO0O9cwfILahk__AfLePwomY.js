(function (window) {
    'use strict';

    /*global define, module, exports, require */

    var c3 = { version: "0.4.11" };

    var c3_chart_fn,
        c3_chart_internal_fn,
        c3_chart_internal_axis_fn;

    function API(owner) {
        this.owner = owner;
    }

    function inherit(base, derived) {

        if (Object.create) {
            derived.prototype = Object.create(base.prototype);
        } else {
            var f = function f() {};
            f.prototype = base.prototype;
            derived.prototype = new f();
        }

        derived.prototype.constructor = derived;

        return derived;
    }

    function Chart(config) {
        var $$ = this.internal = new ChartInternal(this);
        $$.loadConfig(config);

        $$.beforeInit(config);
        $$.init();
        $$.afterInit(config);

        // bind "this" to nested API
        (function bindThis(fn, target, argThis) {
            Object.keys(fn).forEach(function (key) {
                target[key] = fn[key].bind(argThis);
                if (Object.keys(fn[key]).length > 0) {
                    bindThis(fn[key], target[key], argThis);
                }
            });
        })(c3_chart_fn, this, this);
    }

    function ChartInternal(api) {
        var $$ = this;
        $$.d3 = window.d3 ? window.d3 : typeof require !== 'undefined' ? require("d3") : undefined;
        $$.api = api;
        $$.config = $$.getDefaultConfig();
        $$.data = {};
        $$.cache = {};
        $$.axes = {};
    }

    c3.generate = function (config) {
        return new Chart(config);
    };

    c3.chart = {
        fn: Chart.prototype,
        internal: {
            fn: ChartInternal.prototype,
            axis: {
                fn: Axis.prototype
            }
        }
    };
    c3_chart_fn = c3.chart.fn;
    c3_chart_internal_fn = c3.chart.internal.fn;
    c3_chart_internal_axis_fn = c3.chart.internal.axis.fn;

    c3_chart_internal_fn.beforeInit = function () {
        // can do something
    };
    c3_chart_internal_fn.afterInit = function () {
        // can do something
    };
    c3_chart_internal_fn.init = function () {
        var $$ = this, config = $$.config;

        $$.initParams();

        if (config.data_url) {
            $$.convertUrlToData(config.data_url, config.data_mimeType, config.data_headers, config.data_keys, $$.initWithData);
        }
        else if (config.data_json) {
            $$.initWithData($$.convertJsonToData(config.data_json, config.data_keys));
        }
        else if (config.data_rows) {
            $$.initWithData($$.convertRowsToData(config.data_rows));
        }
        else if (config.data_columns) {
            $$.initWithData($$.convertColumnsToData(config.data_columns));
        }
        else {
            throw Error('url or json or rows or columns is required.');
        }
    };

    c3_chart_internal_fn.initParams = function () {
        var $$ = this, d3 = $$.d3, config = $$.config;

        // MEMO: clipId needs to be unique because it conflicts when multiple charts exist
        $$.clipId = "c3-" + (+new Date()) + '-clip',
        $$.clipIdForXAxis = $$.clipId + '-xaxis',
        $$.clipIdForYAxis = $$.clipId + '-yaxis',
        $$.clipIdForGrid = $$.clipId + '-grid',
        $$.clipIdForSubchart = $$.clipId + '-subchart',
        $$.clipPath = $$.getClipPath($$.clipId),
        $$.clipPathForXAxis = $$.getClipPath($$.clipIdForXAxis),
        $$.clipPathForYAxis = $$.getClipPath($$.clipIdForYAxis);
        $$.clipPathForGrid = $$.getClipPath($$.clipIdForGrid),
        $$.clipPathForSubchart = $$.getClipPath($$.clipIdForSubchart),

        $$.dragStart = null;
        $$.dragging = false;
        $$.flowing = false;
        $$.cancelClick = false;
        $$.mouseover = false;
        $$.transiting = false;

        $$.color = $$.generateColor();
        $$.levelColor = $$.generateLevelColor();

        $$.dataTimeFormat = config.data_xLocaltime ? d3.time.format : d3.time.format.utc;
        $$.axisTimeFormat = config.axis_x_localtime ? d3.time.format : d3.time.format.utc;
        $$.defaultAxisTimeFormat = $$.axisTimeFormat.multi([
            [".%L", function (d) { return d.getMilliseconds(); }],
            [":%S", function (d) { return d.getSeconds(); }],
            ["%I:%M", function (d) { return d.getMinutes(); }],
            ["%I %p", function (d) { return d.getHours(); }],
            ["%-m/%-d", function (d) { return d.getDay() && d.getDate() !== 1; }],
            ["%-m/%-d", function (d) { return d.getDate() !== 1; }],
            ["%-m/%-d", function (d) { return d.getMonth(); }],
            ["%Y/%-m/%-d", function () { return true; }]
        ]);

        $$.hiddenTargetIds = [];
        $$.hiddenLegendIds = [];
        $$.focusedTargetIds = [];
        $$.defocusedTargetIds = [];

        $$.xOrient = config.axis_rotated ? "left" : "bottom";
        $$.yOrient = config.axis_rotated ? (config.axis_y_inner ? "top" : "bottom") : (config.axis_y_inner ? "right" : "left");
        $$.y2Orient = config.axis_rotated ? (config.axis_y2_inner ? "bottom" : "top") : (config.axis_y2_inner ? "left" : "right");
        $$.subXOrient = config.axis_rotated ? "left" : "bottom";

        $$.isLegendRight = config.legend_position === 'right';
        $$.isLegendInset = config.legend_position === 'inset';
        $$.isLegendTop = config.legend_inset_anchor === 'top-left' || config.legend_inset_anchor === 'top-right';
        $$.isLegendLeft = config.legend_inset_anchor === 'top-left' || config.legend_inset_anchor === 'bottom-left';
        $$.legendStep = 0;
        $$.legendItemWidth = 0;
        $$.legendItemHeight = 0;

        $$.currentMaxTickWidths = {
            x: 0,
            y: 0,
            y2: 0
        };

        $$.rotated_padding_left = 30;
        $$.rotated_padding_right = config.axis_rotated && !config.axis_x_show ? 0 : 30;
        $$.rotated_padding_top = 5;

        $$.withoutFadeIn = {};

        $$.intervalForObserveInserted = undefined;

        $$.axes.subx = d3.selectAll([]); // needs when excluding subchart.js
    };

    c3_chart_internal_fn.initChartElements = function () {
        if (this.initBar) { this.initBar(); }
        if (this.initLine) { this.initLine(); }
        if (this.initArc) { this.initArc(); }
        if (this.initGauge) { this.initGauge(); }
        if (this.initText) { this.initText(); }
    };

    c3_chart_internal_fn.initWithData = function (data) {
        var $$ = this, d3 = $$.d3, config = $$.config;
        var defs, main, binding = true;

        $$.axis = new Axis($$);

        if ($$.initPie) { $$.initPie(); }
        if ($$.initBrush) { $$.initBrush(); }
        if ($$.initZoom) { $$.initZoom(); }

        if (!config.bindto) {
            $$.selectChart = d3.selectAll([]);
        }
        else if (typeof config.bindto.node === 'function') {
            $$.selectChart = config.bindto;
        }
        else {
            $$.selectChart = d3.select(config.bindto);
        }
        if ($$.selectChart.empty()) {
            $$.selectChart = d3.select(document.createElement('div')).style('opacity', 0);
            $$.observeInserted($$.selectChart);
            binding = false;
        }
        $$.selectChart.html("").classed("c3", true);

        // Init data as targets
        $$.data.xs = {};
        $$.data.targets = $$.convertDataToTargets(data);

        if (config.data_filter) {
            $$.data.targets = $$.data.targets.filter(config.data_filter);
        }

        // Set targets to hide if needed
        if (config.data_hide) {
            $$.addHiddenTargetIds(config.data_hide === true ? $$.mapToIds($$.data.targets) : config.data_hide);
        }
        if (config.legend_hide) {
            $$.addHiddenLegendIds(config.legend_hide === true ? $$.mapToIds($$.data.targets) : config.legend_hide);
        }

        // when gauge, hide legend // TODO: fix
        if ($$.hasType('gauge')) {
            config.legend_show = false;
        }

        // Init sizes and scales
        $$.updateSizes();
        $$.updateScales();

        // Set domains for each scale
        $$.x.domain(d3.extent($$.getXDomain($$.data.targets)));
        $$.y.domain($$.getYDomain($$.data.targets, 'y'));
        $$.y2.domain($$.getYDomain($$.data.targets, 'y2'));
        $$.subX.domain($$.x.domain());
        $$.subY.domain($$.y.domain());
        $$.subY2.domain($$.y2.domain());

        // Save original x domain for zoom update
        $$.orgXDomain = $$.x.domain();

        // Set initialized scales to brush and zoom
        if ($$.brush) { $$.brush.scale($$.subX); }
        if (config.zoom_enabled) { $$.zoom.scale($$.x); }

        /*-- Basic Elements --*/

        // Define svgs
        $$.svg = $$.selectChart.append("svg")
            .style("overflow", "hidden")
            .on('mouseenter', function () { return config.onmouseover.call($$); })
            .on('mouseleave', function () { return config.onmouseout.call($$); });

        if ($$.config.svg_classname) {
            $$.svg.attr('class', $$.config.svg_classname);
        }

        // Define defs
        defs = $$.svg.append("defs");
        $$.clipChart = $$.appendClip(defs, $$.clipId);
        $$.clipXAxis = $$.appendClip(defs, $$.clipIdForXAxis);
        $$.clipYAxis = $$.appendClip(defs, $$.clipIdForYAxis);
        $$.clipGrid = $$.appendClip(defs, $$.clipIdForGrid);
        $$.clipSubchart = $$.appendClip(defs, $$.clipIdForSubchart);
        $$.updateSvgSize();

        // Define regions
        main = $$.main = $$.svg.append("g").attr("transform", $$.getTranslate('main'));

        if ($$.initSubchart) { $$.initSubchart(); }
        if ($$.initTooltip) { $$.initTooltip(); }
        if ($$.initLegend) { $$.initLegend(); }
        if ($$.initTitle) { $$.initTitle(); }

        /*-- Main Region --*/

        // text when empty
        main.append("text")
            .attr("class", CLASS.text + ' ' + CLASS.empty)
            .attr("text-anchor", "middle") // horizontal centering of text at x position in all browsers.
            .attr("dominant-baseline", "middle"); // vertical centering of text at y position in all browsers, except IE.

        // Regions
        $$.initRegion();

        // Grids
        $$.initGrid();

        // Define g for chart area
        main.append('g')
            .attr("clip-path", $$.clipPath)
            .attr('class', CLASS.chart);

        // Grid lines
        if (config.grid_lines_front) { $$.initGridLines(); }

        // Cover whole with rects for events
        $$.initEventRect();

        // Define g for chart
        $$.initChartElements();

        // if zoom privileged, insert rect to forefront
        // TODO: is this needed?
        main.insert('rect', config.zoom_privileged ? null : 'g.' + CLASS.regions)
            .attr('class', CLASS.zoomRect)
            .attr('width', $$.width)
            .attr('height', $$.height)
            .style('opacity', 0)
            .on("dblclick.zoom", null);

        // Set default extent if defined
        if (config.axis_x_extent) { $$.brush.extent($$.getDefaultExtent()); }

        // Add Axis
        $$.axis.init();

        // Set targets
        $$.updateTargets($$.data.targets);

        // Draw with targets
        if (binding) {
            $$.updateDimension();
            $$.config.oninit.call($$);
            $$.redraw({
                withTransition: false,
                withTransform: true,
                withUpdateXDomain: true,
                withUpdateOrgXDomain: true,
                withTransitionForAxis: false
            });
        }

        // Bind resize event
        $$.bindResize();

        // export element of the chart
        $$.api.element = $$.selectChart.node();
    };

    c3_chart_internal_fn.smoothLines = function (el, type) {
        var $$ = this;
        if (type === 'grid') {
            el.each(function () {
                var g = $$.d3.select(this),
                    x1 = g.attr('x1'),
                    x2 = g.attr('x2'),
                    y1 = g.attr('y1'),
                    y2 = g.attr('y2');
                g.attr({
                    'x1': Math.ceil(x1),
                    'x2': Math.ceil(x2),
                    'y1': Math.ceil(y1),
                    'y2': Math.ceil(y2)
                });
            });
        }
    };


    c3_chart_internal_fn.updateSizes = function () {
        var $$ = this, config = $$.config;
        var legendHeight = $$.legend ? $$.getLegendHeight() : 0,
            legendWidth = $$.legend ? $$.getLegendWidth() : 0,
            legendHeightForBottom = $$.isLegendRight || $$.isLegendInset ? 0 : legendHeight,
            hasArc = $$.hasArcType(),
            xAxisHeight = config.axis_rotated || hasArc ? 0 : $$.getHorizontalAxisHeight('x'),
            subchartHeight = config.subchart_show && !hasArc ? (config.subchart_size_height + xAxisHeight) : 0;

        $$.currentWidth = $$.getCurrentWidth();
        $$.currentHeight = $$.getCurrentHeight();

        // for main
        $$.margin = config.axis_rotated ? {
            top: $$.getHorizontalAxisHeight('y2') + $$.getCurrentPaddingTop(),
            right: hasArc ? 0 : $$.getCurrentPaddingRight(),
            bottom: $$.getHorizontalAxisHeight('y') + legendHeightForBottom + $$.getCurrentPaddingBottom(),
            left: subchartHeight + (hasArc ? 0 : $$.getCurrentPaddingLeft())
        } : {
            top: 4 + $$.getCurrentPaddingTop(), // for top tick text
            right: hasArc ? 0 : $$.getCurrentPaddingRight(),
            bottom: xAxisHeight + subchartHeight + legendHeightForBottom + $$.getCurrentPaddingBottom(),
            left: hasArc ? 0 : $$.getCurrentPaddingLeft()
        };

        // for subchart
        $$.margin2 = config.axis_rotated ? {
            top: $$.margin.top,
            right: NaN,
            bottom: 20 + legendHeightForBottom,
            left: $$.rotated_padding_left
        } : {
            top: $$.currentHeight - subchartHeight - legendHeightForBottom,
            right: NaN,
            bottom: xAxisHeight + legendHeightForBottom,
            left: $$.margin.left
        };

        // for legend
        $$.margin3 = {
            top: 0,
            right: NaN,
            bottom: 0,
            left: 0
        };
        if ($$.updateSizeForLegend) { $$.updateSizeForLegend(legendHeight, legendWidth); }

        $$.width = $$.currentWidth - $$.margin.left - $$.margin.right;
        $$.height = $$.currentHeight - $$.margin.top - $$.margin.bottom;
        if ($$.width < 0) { $$.width = 0; }
        if ($$.height < 0) { $$.height = 0; }

        $$.width2 = config.axis_rotated ? $$.margin.left - $$.rotated_padding_left - $$.rotated_padding_right : $$.width;
        $$.height2 = config.axis_rotated ? $$.height : $$.currentHeight - $$.margin2.top - $$.margin2.bottom;
        if ($$.width2 < 0) { $$.width2 = 0; }
        if ($$.height2 < 0) { $$.height2 = 0; }

        // for arc
        $$.arcWidth = $$.width - ($$.isLegendRight ? legendWidth + 10 : 0);
        $$.arcHeight = $$.height - ($$.isLegendRight ? 0 : 10);
        if ($$.hasType('gauge') && !config.gauge_fullCircle) {
            $$.arcHeight += $$.height - $$.getGaugeLabelHeight();
        }
        if ($$.updateRadius) { $$.updateRadius(); }

        if ($$.isLegendRight && hasArc) {
            $$.margin3.left = $$.arcWidth / 2 + $$.radiusExpanded * 1.1;
        }
    };

    c3_chart_internal_fn.updateTargets = function (targets) {
        var $$ = this;

        /*-- Main --*/

        //-- Text --//
        $$.updateTargetsForText(targets);

        //-- Bar --//
        $$.updateTargetsForBar(targets);

        //-- Line --//
        $$.updateTargetsForLine(targets);

        //-- Arc --//
        if ($$.hasArcType() && $$.updateTargetsForArc) { $$.updateTargetsForArc(targets); }

        /*-- Sub --*/

        if ($$.updateTargetsForSubchart) { $$.updateTargetsForSubchart(targets); }

        // Fade-in each chart
        $$.showTargets();
    };
    c3_chart_internal_fn.showTargets = function () {
        var $$ = this;
        $$.svg.selectAll('.' + CLASS.target).filter(function (d) { return $$.isTargetToShow(d.id); })
          .transition().duration($$.config.transition_duration)
            .style("opacity", 1);
    };

    c3_chart_internal_fn.redraw = function (options, transitions) {
        var $$ = this, main = $$.main, d3 = $$.d3, config = $$.config;
        var areaIndices = $$.getShapeIndices($$.isAreaType), barIndices = $$.getShapeIndices($$.isBarType), lineIndices = $$.getShapeIndices($$.isLineType);
        var withY, withSubchart, withTransition, withTransitionForExit, withTransitionForAxis,
            withTransform, withUpdateXDomain, withUpdateOrgXDomain, withTrimXDomain, withLegend,
            withEventRect, withDimension, withUpdateXAxis;
        var hideAxis = $$.hasArcType();
        var drawArea, drawBar, drawLine, xForText, yForText;
        var duration, durationForExit, durationForAxis;
        var waitForDraw, flow;
        var targetsToShow = $$.filterTargetsToShow($$.data.targets), tickValues, i, intervalForCulling, xDomainForZoom;
        var xv = $$.xv.bind($$), cx, cy;

        options = options || {};
        withY = getOption(options, "withY", true);
        withSubchart = getOption(options, "withSubchart", true);
        withTransition = getOption(options, "withTransition", true);
        withTransform = getOption(options, "withTransform", false);
        withUpdateXDomain = getOption(options, "withUpdateXDomain", false);
        withUpdateOrgXDomain = getOption(options, "withUpdateOrgXDomain", false);
        withTrimXDomain = getOption(options, "withTrimXDomain", true);
        withUpdateXAxis = getOption(options, "withUpdateXAxis", withUpdateXDomain);
        withLegend = getOption(options, "withLegend", false);
        withEventRect = getOption(options, "withEventRect", true);
        withDimension = getOption(options, "withDimension", true);
        withTransitionForExit = getOption(options, "withTransitionForExit", withTransition);
        withTransitionForAxis = getOption(options, "withTransitionForAxis", withTransition);

        duration = withTransition ? config.transition_duration : 0;
        durationForExit = withTransitionForExit ? duration : 0;
        durationForAxis = withTransitionForAxis ? duration : 0;

        transitions = transitions || $$.axis.generateTransitions(durationForAxis);

        // update legend and transform each g
        if (withLegend && config.legend_show) {
            $$.updateLegend($$.mapToIds($$.data.targets), options, transitions);
        } else if (withDimension) {
            // need to update dimension (e.g. axis.y.tick.values) because y tick values should change
            // no need to update axis in it because they will be updated in redraw()
            $$.updateDimension(true);
        }

        // MEMO: needed for grids calculation
        if ($$.isCategorized() && targetsToShow.length === 0) {
            $$.x.domain([0, $$.axes.x.selectAll('.tick').size()]);
        }

        if (targetsToShow.length) {
            $$.updateXDomain(targetsToShow, withUpdateXDomain, withUpdateOrgXDomain, withTrimXDomain);
            if (!config.axis_x_tick_values) {
                tickValues = $$.axis.updateXAxisTickValues(targetsToShow);
            }
        } else {
            $$.xAxis.tickValues([]);
            $$.subXAxis.tickValues([]);
        }

        if (config.zoom_rescale && !options.flow) {
            xDomainForZoom = $$.x.orgDomain();
        }

        $$.y.domain($$.getYDomain(targetsToShow, 'y', xDomainForZoom));
        $$.y2.domain($$.getYDomain(targetsToShow, 'y2', xDomainForZoom));

        if (!config.axis_y_tick_values && config.axis_y_tick_count) {
            $$.yAxis.tickValues($$.axis.generateTickValues($$.y.domain(), config.axis_y_tick_count));
        }
        if (!config.axis_y2_tick_values && config.axis_y2_tick_count) {
            $$.y2Axis.tickValues($$.axis.generateTickValues($$.y2.domain(), config.axis_y2_tick_count));
        }

        // axes
        $$.axis.redraw(transitions, hideAxis);

        // Update axis label
        $$.axis.updateLabels(withTransition);

        // show/hide if manual culling needed
        if ((withUpdateXDomain || withUpdateXAxis) && targetsToShow.length) {
            if (config.axis_x_tick_culling && tickValues) {
                for (i = 1; i < tickValues.length; i++) {
                    if (tickValues.length / i < config.axis_x_tick_culling_max) {
                        intervalForCulling = i;
                        break;
                    }
                }
                $$.svg.selectAll('.' + CLASS.axisX + ' .tick text').each(function (e) {
                    var index = tickValues.indexOf(e);
                    if (index >= 0) {
                        d3.select(this).style('display', index % intervalForCulling ? 'none' : 'block');
                    }
                });
            } else {
                $$.svg.selectAll('.' + CLASS.axisX + ' .tick text').style('display', 'block');
            }
        }

        // setup drawer - MEMO: these must be called after axis updated
        drawArea = $$.generateDrawArea ? $$.generateDrawArea(areaIndices, false) : undefined;
        drawBar = $$.generateDrawBar ? $$.generateDrawBar(barIndices) : undefined;
        drawLine = $$.generateDrawLine ? $$.generateDrawLine(lineIndices, false) : undefined;
        xForText = $$.generateXYForText(areaIndices, barIndices, lineIndices, true);
        yForText = $$.generateXYForText(areaIndices, barIndices, lineIndices, false);

        // Update sub domain
        if (withY) {
            $$.subY.domain($$.getYDomain(targetsToShow, 'y'));
            $$.subY2.domain($$.getYDomain(targetsToShow, 'y2'));
        }

        // xgrid focus
        $$.updateXgridFocus();

        // Data empty label positioning and text.
        main.select("text." + CLASS.text + '.' + CLASS.empty)
            .attr("x", $$.width / 2)
            .attr("y", $$.height / 2)
            .text(config.data_empty_label_text)
          .transition()
            .style('opacity', targetsToShow.length ? 0 : 1);

        // grid
        $$.updateGrid(duration);

        // rect for regions
        $$.updateRegion(duration);

        // bars
        $$.updateBar(durationForExit);

        // lines, areas and cricles
        $$.updateLine(durationForExit);
        $$.updateArea(durationForExit);
        $$.updateCircle();

        // text
        if ($$.hasDataLabel()) {
            $$.updateText(durationForExit);
        }

        // title
        if ($$.redrawTitle) { $$.redrawTitle(); }

        // arc
        if ($$.redrawArc) { $$.redrawArc(duration, durationForExit, withTransform); }

        // subchart
        if ($$.redrawSubchart) {
            $$.redrawSubchart(withSubchart, transitions, duration, durationForExit, areaIndices, barIndices, lineIndices);
        }

        // circles for select
        main.selectAll('.' + CLASS.selectedCircles)
            .filter($$.isBarType.bind($$))
            .selectAll('circle')
            .remove();

        // event rects will redrawn when flow called
        if (config.interaction_enabled && !options.flow && withEventRect) {
            $$.redrawEventRect();
            if ($$.updateZoom) { $$.updateZoom(); }
        }

        // update circleY based on updated parameters
        $$.updateCircleY();

        // generate circle x/y functions depending on updated params
        cx = ($$.config.axis_rotated ? $$.circleY : $$.circleX).bind($$);
        cy = ($$.config.axis_rotated ? $$.circleX : $$.circleY).bind($$);

        if (options.flow) {
            flow = $$.generateFlow({
                targets: targetsToShow,
                flow: options.flow,
                duration: options.flow.duration,
                drawBar: drawBar,
                drawLine: drawLine,
                drawArea: drawArea,
                cx: cx,
                cy: cy,
                xv: xv,
                xForText: xForText,
                yForText: yForText
            });
        }

        if ((duration || flow) && $$.isTabVisible()) { // Only use transition if tab visible. See #938.
            // transition should be derived from one transition
            d3.transition().duration(duration).each(function () {
                var transitionsToWait = [];

                // redraw and gather transitions
                [
                    $$.redrawBar(drawBar, true),
                    $$.redrawLine(drawLine, true),
                    $$.redrawArea(drawArea, true),
                    $$.redrawCircle(cx, cy, true),
                    $$.redrawText(xForText, yForText, options.flow, true),
                    $$.redrawRegion(true),
                    $$.redrawGrid(true),
                ].forEach(function (transitions) {
                    transitions.forEach(function (transition) {
                        transitionsToWait.push(transition);
                    });
                });

                // Wait for end of transitions to call flow and onrendered callback
                waitForDraw = $$.generateWait();
                transitionsToWait.forEach(function (t) {
                    waitForDraw.add(t);
                });
            })
            .call(waitForDraw, function () {
                if (flow) {
                    flow();
                }
                if (config.onrendered) {
                    config.onrendered.call($$);
                }
            });
        }
        else {
            $$.redrawBar(drawBar);
            $$.redrawLine(drawLine);
            $$.redrawArea(drawArea);
            $$.redrawCircle(cx, cy);
            $$.redrawText(xForText, yForText, options.flow);
            $$.redrawRegion();
            $$.redrawGrid();
            if (config.onrendered) {
                config.onrendered.call($$);
            }
        }

        // update fadein condition
        $$.mapToIds($$.data.targets).forEach(function (id) {
            $$.withoutFadeIn[id] = true;
        });
    };

    c3_chart_internal_fn.updateAndRedraw = function (options) {
        var $$ = this, config = $$.config, transitions;
        options = options || {};
        // same with redraw
        options.withTransition = getOption(options, "withTransition", true);
        options.withTransform = getOption(options, "withTransform", false);
        options.withLegend = getOption(options, "withLegend", false);
        // NOT same with redraw
        options.withUpdateXDomain = true;
        options.withUpdateOrgXDomain = true;
        options.withTransitionForExit = false;
        options.withTransitionForTransform = getOption(options, "withTransitionForTransform", options.withTransition);
        // MEMO: this needs to be called before updateLegend and it means this ALWAYS needs to be called)
        $$.updateSizes();
        // MEMO: called in updateLegend in redraw if withLegend
        if (!(options.withLegend && config.legend_show)) {
            transitions = $$.axis.generateTransitions(options.withTransitionForAxis ? config.transition_duration : 0);
            // Update scales
            $$.updateScales();
            $$.updateSvgSize();
            // Update g positions
            $$.transformAll(options.withTransitionForTransform, transitions);
        }
        // Draw with new sizes & scales
        $$.redraw(options, transitions);
    };
    c3_chart_internal_fn.redrawWithoutRescale = function () {
        this.redraw({
            withY: false,
            withSubchart: false,
            withEventRect: false,
            withTransitionForAxis: false
        });
    };

    c3_chart_internal_fn.isTimeSeries = function () {
        return this.config.axis_x_type === 'timeseries';
    };
    c3_chart_internal_fn.isCategorized = function () {
        return this.config.axis_x_type.indexOf('categor') >= 0;
    };
    c3_chart_internal_fn.isCustomX = function () {
        var $$ = this, config = $$.config;
        return !$$.isTimeSeries() && (config.data_x || notEmpty(config.data_xs));
    };

    c3_chart_internal_fn.isTimeSeriesY = function () {
        return this.config.axis_y_type === 'timeseries';
    };

    c3_chart_internal_fn.getTranslate = function (target) {
        var $$ = this, config = $$.config, x, y;
        if (target === 'main') {
            x = asHalfPixel($$.margin.left);
            y = asHalfPixel($$.margin.top);
        } else if (target === 'context') {
            x = asHalfPixel($$.margin2.left);
            y = asHalfPixel($$.margin2.top);
        } else if (target === 'legend') {
            x = $$.margin3.left;
            y = $$.margin3.top;
        } else if (target === 'x') {
            x = 0;
            y = config.axis_rotated ? 0 : $$.height;
        } else if (target === 'y') {
            x = 0;
            y = config.axis_rotated ? $$.height : 0;
        } else if (target === 'y2') {
            x = config.axis_rotated ? 0 : $$.width;
            y = config.axis_rotated ? 1 : 0;
        } else if (target === 'subx') {
            x = 0;
            y = config.axis_rotated ? 0 : $$.height2;
        } else if (target === 'arc') {
            x = $$.arcWidth / 2;
            y = $$.arcHeight / 2;
        }
        return "translate(" + x + "," + y + ")";
    };
    c3_chart_internal_fn.initialOpacity = function (d) {
        return d.value !== null && this.withoutFadeIn[d.id] ? 1 : 0;
    };
    c3_chart_internal_fn.initialOpacityForCircle = function (d) {
        return d.value !== null && this.withoutFadeIn[d.id] ? this.opacityForCircle(d) : 0;
    };
    c3_chart_internal_fn.opacityForCircle = function (d) {
        var opacity = this.config.point_show ? 1 : 0;
        return isValue(d.value) ? (this.isScatterType(d) ? 0.5 : opacity) : 0;
    };
    c3_chart_internal_fn.opacityForText = function () {
        return this.hasDataLabel() ? 1 : 0;
    };
    c3_chart_internal_fn.xx = function (d) {
        return d ? this.x(d.x) : null;
    };
    c3_chart_internal_fn.xv = function (d) {
        var $$ = this, value = d.value;
        if ($$.isTimeSeries()) {
            value = $$.parseDate(d.value);
        }
        else if ($$.isCategorized() && typeof d.value === 'string') {
            value = $$.config.axis_x_categories.indexOf(d.value);
        }
        return Math.ceil($$.x(value));
    };
    c3_chart_internal_fn.yv = function (d) {
        var $$ = this,
            yScale = d.axis && d.axis === 'y2' ? $$.y2 : $$.y;
        return Math.ceil(yScale(d.value));
    };
    c3_chart_internal_fn.subxx = function (d) {
        return d ? this.subX(d.x) : null;
    };

    c3_chart_internal_fn.transformMain = function (withTransition, transitions) {
        var $$ = this,
            xAxis, yAxis, y2Axis;
        if (transitions && transitions.axisX) {
            xAxis = transitions.axisX;
        } else {
            xAxis  = $$.main.select('.' + CLASS.axisX);
            if (withTransition) { xAxis = xAxis.transition(); }
        }
        if (transitions && transitions.axisY) {
            yAxis = transitions.axisY;
        } else {
            yAxis = $$.main.select('.' + CLASS.axisY);
            if (withTransition) { yAxis = yAxis.transition(); }
        }
        if (transitions && transitions.axisY2) {
            y2Axis = transitions.axisY2;
        } else {
            y2Axis = $$.main.select('.' + CLASS.axisY2);
            if (withTransition) { y2Axis = y2Axis.transition(); }
        }
        (withTransition ? $$.main.transition() : $$.main).attr("transform", $$.getTranslate('main'));
        xAxis.attr("transform", $$.getTranslate('x'));
        yAxis.attr("transform", $$.getTranslate('y'));
        y2Axis.attr("transform", $$.getTranslate('y2'));
        $$.main.select('.' + CLASS.chartArcs).attr("transform", $$.getTranslate('arc'));
    };
    c3_chart_internal_fn.transformAll = function (withTransition, transitions) {
        var $$ = this;
        $$.transformMain(withTransition, transitions);
        if ($$.config.subchart_show) { $$.transformContext(withTransition, transitions); }
        if ($$.legend) { $$.transformLegend(withTransition); }
    };

    c3_chart_internal_fn.updateSvgSize = function () {
        var $$ = this,
            brush = $$.svg.select(".c3-brush .background");
        $$.svg.attr('width', $$.currentWidth).attr('height', $$.currentHeight);
        $$.svg.selectAll(['#' + $$.clipId, '#' + $$.clipIdForGrid]).select('rect')
            .attr('width', $$.width)
            .attr('height', $$.height);
        $$.svg.select('#' + $$.clipIdForXAxis).select('rect')
            .attr('x', $$.getXAxisClipX.bind($$))
            .attr('y', $$.getXAxisClipY.bind($$))
            .attr('width', $$.getXAxisClipWidth.bind($$))
            .attr('height', $$.getXAxisClipHeight.bind($$));
        $$.svg.select('#' + $$.clipIdForYAxis).select('rect')
            .attr('x', $$.getYAxisClipX.bind($$))
            .attr('y', $$.getYAxisClipY.bind($$))
            .attr('width', $$.getYAxisClipWidth.bind($$))
            .attr('height', $$.getYAxisClipHeight.bind($$));
        $$.svg.select('#' + $$.clipIdForSubchart).select('rect')
            .attr('width', $$.width)
            .attr('height', brush.size() ? brush.attr('height') : 0);
        $$.svg.select('.' + CLASS.zoomRect)
            .attr('width', $$.width)
            .attr('height', $$.height);
        // MEMO: parent div's height will be bigger than svg when <!DOCTYPE html>
        $$.selectChart.style('max-height', $$.currentHeight + "px");
    };


    c3_chart_internal_fn.updateDimension = function (withoutAxis) {
        var $$ = this;
        if (!withoutAxis) {
            if ($$.config.axis_rotated) {
                $$.axes.x.call($$.xAxis);
                $$.axes.subx.call($$.subXAxis);
            } else {
                $$.axes.y.call($$.yAxis);
                $$.axes.y2.call($$.y2Axis);
            }
        }
        $$.updateSizes();
        $$.updateScales();
        $$.updateSvgSize();
        $$.transformAll(false);
    };

    c3_chart_internal_fn.observeInserted = function (selection) {
        var $$ = this, observer;
        if (typeof MutationObserver === 'undefined') {
            window.console.error("MutationObserver not defined.");
            return;
        }
        observer= new MutationObserver(function (mutations) {
            mutations.forEach(function (mutation) {
                if (mutation.type === 'childList' && mutation.previousSibling) {
                    observer.disconnect();
                    // need to wait for completion of load because size calculation requires the actual sizes determined after that completion
                    $$.intervalForObserveInserted = window.setInterval(function () {
                        // parentNode will NOT be null when completed
                        if (selection.node().parentNode) {
                            window.clearInterval($$.intervalForObserveInserted);
                            $$.updateDimension();
                            if ($$.brush) { $$.brush.update(); }
                            $$.config.oninit.call($$);
                            $$.redraw({
                                withTransform: true,
                                withUpdateXDomain: true,
                                withUpdateOrgXDomain: true,
                                withTransition: false,
                                withTransitionForTransform: false,
                                withLegend: true
                            });
                            selection.transition().style('opacity', 1);
                        }
                    }, 10);
                }
            });
        });
        observer.observe(selection.node(), {attributes: true, childList: true, characterData: true});
    };

    c3_chart_internal_fn.bindResize = function () {
        var $$ = this, config = $$.config;

        $$.resizeFunction = $$.generateResize();

        $$.resizeFunction.add(function () {
            config.onresize.call($$);
        });
        if (config.resize_auto) {
            $$.resizeFunction.add(function () {
                if ($$.resizeTimeout !== undefined) {
                    window.clearTimeout($$.resizeTimeout);
                }
                $$.resizeTimeout = window.setTimeout(function () {
                    delete $$.resizeTimeout;
                    $$.api.flush();
                }, 100);
            });
        }
        $$.resizeFunction.add(function () {
            config.onresized.call($$);
        });

        if (window.attachEvent) {
            window.attachEvent('onresize', $$.resizeFunction);
        } else if (window.addEventListener) {
            window.addEventListener('resize', $$.resizeFunction, false);
        } else {
            // fallback to this, if this is a very old browser
            var wrapper = window.onresize;
            if (!wrapper) {
                // create a wrapper that will call all charts
                wrapper = $$.generateResize();
            } else if (!wrapper.add || !wrapper.remove) {
                // there is already a handler registered, make sure we call it too
                wrapper = $$.generateResize();
                wrapper.add(window.onresize);
            }
            // add this graph to the wrapper, we will be removed if the user calls destroy
            wrapper.add($$.resizeFunction);
            window.onresize = wrapper;
        }
    };

    c3_chart_internal_fn.generateResize = function () {
        var resizeFunctions = [];
        function callResizeFunctions() {
            resizeFunctions.forEach(function (f) {
                f();
            });
        }
        callResizeFunctions.add = function (f) {
            resizeFunctions.push(f);
        };
        callResizeFunctions.remove = function (f) {
            for (var i = 0; i < resizeFunctions.length; i++) {
                if (resizeFunctions[i] === f) {
                    resizeFunctions.splice(i, 1);
                    break;
                }
            }
        };
        return callResizeFunctions;
    };

    c3_chart_internal_fn.endall = function (transition, callback) {
        var n = 0;
        transition
            .each(function () { ++n; })
            .each("end", function () {
                if (!--n) { callback.apply(this, arguments); }
            });
    };
    c3_chart_internal_fn.generateWait = function () {
        var transitionsToWait = [],
            f = function (transition, callback) {
                var timer = setInterval(function () {
                    var done = 0;
                    transitionsToWait.forEach(function (t) {
                        if (t.empty()) {
                            done += 1;
                            return;
                        }
                        try {
                            t.transition();
                        } catch (e) {
                            done += 1;
                        }
                    });
                    if (done === transitionsToWait.length) {
                        clearInterval(timer);
                        if (callback) { callback(); }
                    }
                }, 10);
            };
        f.add = function (transition) {
            transitionsToWait.push(transition);
        };
        return f;
    };

    c3_chart_internal_fn.parseDate = function (date) {
        var $$ = this, parsedDate;
        if (date instanceof Date) {
            parsedDate = date;
        } else if (typeof date === 'string') {
            parsedDate = $$.dataTimeFormat($$.config.data_xFormat).parse(date);
        } else if (typeof date === 'number' && !isNaN(date)) {
            parsedDate = new Date(+date);
        }
        if (!parsedDate || isNaN(+parsedDate)) {
            window.console.error("Failed to parse x '" + date + "' to Date object");
        }
        return parsedDate;
    };

    c3_chart_internal_fn.isTabVisible = function () {
        var hidden;
        if (typeof document.hidden !== "undefined") { // Opera 12.10 and Firefox 18 and later support
            hidden = "hidden";
        } else if (typeof document.mozHidden !== "undefined") {
            hidden = "mozHidden";
        } else if (typeof document.msHidden !== "undefined") {
            hidden = "msHidden";
        } else if (typeof document.webkitHidden !== "undefined") {
            hidden = "webkitHidden";
        }

        return document[hidden] ? false : true;
    };

    c3_chart_internal_fn.getDefaultConfig = function () {
        var config = {
            bindto: '#chart',
            svg_classname: undefined,
            size_width: undefined,
            size_height: undefined,
            padding_left: undefined,
            padding_right: undefined,
            padding_top: undefined,
            padding_bottom: undefined,
            resize_auto: true,
            zoom_enabled: false,
            zoom_extent: undefined,
            zoom_privileged: false,
            zoom_rescale: false,
            zoom_onzoom: function () {},
            zoom_onzoomstart: function () {},
            zoom_onzoomend: function () {},
            zoom_x_min: undefined,
            zoom_x_max: undefined,
            interaction_brighten: true,
            interaction_enabled: true,
            onmouseover: function () {},
            onmouseout: function () {},
            onresize: function () {},
            onresized: function () {},
            oninit: function () {},
            onrendered: function () {},
            transition_duration: 350,
            data_x: undefined,
            data_xs: {},
            data_xFormat: '%Y-%m-%d',
            data_xLocaltime: true,
            data_xSort: true,
            data_idConverter: function (id) { return id; },
            data_names: {},
            data_classes: {},
            data_groups: [],
            data_axes: {},
            data_type: undefined,
            data_types: {},
            data_labels: {},
            data_order: 'desc',
            data_regions: {},
            data_color: undefined,
            data_colors: {},
            data_hide: false,
            data_filter: undefined,
            data_selection_enabled: false,
            data_selection_grouped: false,
            data_selection_isselectable: function () { return true; },
            data_selection_multiple: true,
            data_selection_draggable: false,
            data_onclick: function () {},
            data_onmouseover: function () {},
            data_onmouseout: function () {},
            data_onselected: function () {},
            data_onunselected: function () {},
            data_url: undefined,
            data_headers: undefined,
            data_json: undefined,
            data_rows: undefined,
            data_columns: undefined,
            data_mimeType: undefined,
            data_keys: undefined,
            // configuration for no plot-able data supplied.
            data_empty_label_text: "",
            // subchart
            subchart_show: false,
            subchart_size_height: 60,
            subchart_axis_x_show: true,
            subchart_onbrush: function () {},
            // color
            color_pattern: [],
            color_threshold: {},
            // legend
            legend_show: true,
            legend_hide: false,
            legend_position: 'bottom',
            legend_inset_anchor: 'top-left',
            legend_inset_x: 10,
            legend_inset_y: 0,
            legend_inset_step: undefined,
            legend_item_onclick: undefined,
            legend_item_onmouseover: undefined,
            legend_item_onmouseout: undefined,
            legend_equally: false,
            legend_padding: 0,
            legend_item_tile_width: 10,
            legend_item_tile_height: 10,
            // axis
            axis_rotated: false,
            axis_x_show: true,
            axis_x_type: 'indexed',
            axis_x_localtime: true,
            axis_x_categories: [],
            axis_x_tick_centered: false,
            axis_x_tick_format: undefined,
            axis_x_tick_culling: {},
            axis_x_tick_culling_max: 10,
            axis_x_tick_count: undefined,
            axis_x_tick_fit: true,
            axis_x_tick_values: null,
            axis_x_tick_rotate: 0,
            axis_x_tick_outer: true,
            axis_x_tick_multiline: true,
            axis_x_tick_offset: 12,
            axis_x_tick_width: null,
            axis_x_max: undefined,
            axis_x_min: undefined,
            axis_x_padding: {},
            axis_x_height: undefined,
            axis_x_extent: undefined,
            axis_x_label: {},
            axis_y_show: true,
            axis_y_type: undefined,
            axis_y_max: undefined,
            axis_y_min: undefined,
            axis_y_inverted: false,
            axis_y_center: undefined,
            axis_y_inner: undefined,
            axis_y_label: {},
            axis_y_tick_format: undefined,
            axis_y_tick_outer: true,
            axis_y_tick_values: null,
            axis_y_tick_rotate: 0,
            axis_y_tick_count: undefined,
            axis_y_tick_time_value: undefined,
            axis_y_tick_time_interval: undefined,
            axis_y_padding: {},
            axis_y_default: undefined,
            axis_y2_show: false,
            axis_y2_max: undefined,
            axis_y2_min: undefined,
            axis_y2_inverted: false,
            axis_y2_center: undefined,
            axis_y2_inner: undefined,
            axis_y2_label: {},
            axis_y2_tick_format: undefined,
            axis_y2_tick_outer: true,
            axis_y2_tick_values: null,
            axis_y2_tick_count: undefined,
            axis_y2_padding: {},
            axis_y2_default: undefined,
            // grid
            grid_x_show: false,
            grid_x_type: 'tick',
            grid_x_lines: [],
            grid_y_show: false,
            // not used
            // grid_y_type: 'tick',
            grid_y_lines: [],
            grid_y_ticks: 10,
            grid_focus_show: true,
            grid_lines_front: true,
            // point - point of each data
            point_show: true,
            point_r: 2.5,
            point_sensitivity: 10,
            point_focus_expand_enabled: true,
            point_focus_expand_r: undefined,
            point_select_r: undefined,
            // line
            line_connectNull: false,
            line_step_type: 'step',
            // bar
            bar_width: undefined,
            bar_width_ratio: 0.6,
            bar_width_max: undefined,
            bar_zerobased: true,
            // area
            area_zerobased: true,
            area_above: false,
            // pie
            pie_label_show: true,
            pie_label_format: undefined,
            pie_label_threshold: 0.05,
            pie_label_ratio: undefined,
            pie_expand: {},
            pie_expand_duration: 50,
            // gauge
            gauge_fullCircle: false,
            gauge_label_show: true,
            gauge_label_format: undefined,
            gauge_min: 0,
            gauge_max: 100,
            gauge_startingAngle: -1 * Math.PI/2,
            gauge_units: undefined,
            gauge_width: undefined,
            gauge_expand: {},
            gauge_expand_duration: 50,
            // donut
            donut_label_show: true,
            donut_label_format: undefined,
            donut_label_threshold: 0.05,
            donut_label_ratio: undefined,
            donut_width: undefined,
            donut_title: "",
            donut_expand: {},
            donut_expand_duration: 50,
            // spline
            spline_interpolation_type: 'cardinal',
            // region - region to change style
            regions: [],
            // tooltip - show when mouseover on each data
            tooltip_show: true,
            tooltip_grouped: true,
            tooltip_format_title: undefined,
            tooltip_format_name: undefined,
            tooltip_format_value: undefined,
            tooltip_position: undefined,
            tooltip_contents: function (d, defaultTitleFormat, defaultValueFormat, color) {
                return this.getTooltipContent ? this.getTooltipContent(d, defaultTitleFormat, defaultValueFormat, color) : '';
            },
            tooltip_init_show: false,
            tooltip_init_x: 0,
            tooltip_init_position: {top: '0px', left: '50px'},
            tooltip_onshow: function () {},
            tooltip_onhide: function () {},
            // title
            title_text: undefined,
            title_padding: {
                top: 0,
                right: 0,
                bottom: 0,
                left: 0
            },
            title_position: 'top-center',
        };

        Object.keys(this.additionalConfig).forEach(function (key) {
            config[key] = this.additionalConfig[key];
        }, this);

        return config;
    };
    c3_chart_internal_fn.additionalConfig = {};

    c3_chart_internal_fn.loadConfig = function (config) {
        var this_config = this.config, target, keys, read;
        function find() {
            var key = keys.shift();
    //        console.log("key =>", key, ", target =>", target);
            if (key && target && typeof target === 'object' && key in target) {
                target = target[key];
                return find();
            }
            else if (!key) {
                return target;
            }
            else {
                return undefined;
            }
        }
        Object.keys(this_config).forEach(function (key) {
            target = config;
            keys = key.split('_');
            read = find();
    //        console.log("CONFIG : ", key, read);
            if (isDefined(read)) {
                this_config[key] = read;
            }
        });
    };

    c3_chart_internal_fn.getScale = function (min, max, forTimeseries) {
        return (forTimeseries ? this.d3.time.scale() : this.d3.scale.linear()).range([min, max]);
    };
    c3_chart_internal_fn.getX = function (min, max, domain, offset) {
        var $$ = this,
            scale = $$.getScale(min, max, $$.isTimeSeries()),
            _scale = domain ? scale.domain(domain) : scale, key;
        // Define customized scale if categorized axis
        if ($$.isCategorized()) {
            offset = offset || function () { return 0; };
            scale = function (d, raw) {
                var v = _scale(d) + offset(d);
                return raw ? v : Math.ceil(v);
            };
        } else {
            scale = function (d, raw) {
                var v = _scale(d);
                return raw ? v : Math.ceil(v);
            };
        }
        // define functions
        for (key in _scale) {
            scale[key] = _scale[key];
        }
        scale.orgDomain = function () {
            return _scale.domain();
        };
        // define custom domain() for categorized axis
        if ($$.isCategorized()) {
            scale.domain = function (domain) {
                if (!arguments.length) {
                    domain = this.orgDomain();
                    return [domain[0], domain[1] + 1];
                }
                _scale.domain(domain);
                return scale;
            };
        }
        return scale;
    };
    c3_chart_internal_fn.getY = function (min, max, domain) {
        var scale = this.getScale(min, max, this.isTimeSeriesY());
        if (domain) { scale.domain(domain); }
        return scale;
    };
    c3_chart_internal_fn.getYScale = function (id) {
        return this.axis.getId(id) === 'y2' ? this.y2 : this.y;
    };
    c3_chart_internal_fn.getSubYScale = function (id) {
        return this.axis.getId(id) === 'y2' ? this.subY2 : this.subY;
    };
    c3_chart_internal_fn.updateScales = function () {
        var $$ = this, config = $$.config,
            forInit = !$$.x;
        // update edges
        $$.xMin = config.axis_rotated ? 1 : 0;
        $$.xMax = config.axis_rotated ? $$.height : $$.width;
        $$.yMin = config.axis_rotated ? 0 : $$.height;
        $$.yMax = config.axis_rotated ? $$.width : 1;
        $$.subXMin = $$.xMin;
        $$.subXMax = $$.xMax;
        $$.subYMin = config.axis_rotated ? 0 : $$.height2;
        $$.subYMax = config.axis_rotated ? $$.width2 : 1;
        // update scales
        $$.x = $$.getX($$.xMin, $$.xMax, forInit ? undefined : $$.x.orgDomain(), function () { return $$.xAxis.tickOffset(); });
        $$.y = $$.getY($$.yMin, $$.yMax, forInit ? config.axis_y_default : $$.y.domain());
        $$.y2 = $$.getY($$.yMin, $$.yMax, forInit ? config.axis_y2_default : $$.y2.domain());
        $$.subX = $$.getX($$.xMin, $$.xMax, $$.orgXDomain, function (d) { return d % 1 ? 0 : $$.subXAxis.tickOffset(); });
        $$.subY = $$.getY($$.subYMin, $$.subYMax, forInit ? config.axis_y_default : $$.subY.domain());
        $$.subY2 = $$.getY($$.subYMin, $$.subYMax, forInit ? config.axis_y2_default : $$.subY2.domain());
        // update axes
        $$.xAxisTickFormat = $$.axis.getXAxisTickFormat();
        $$.xAxisTickValues = $$.axis.getXAxisTickValues();
        $$.yAxisTickValues = $$.axis.getYAxisTickValues();
        $$.y2AxisTickValues = $$.axis.getY2AxisTickValues();

        $$.xAxis = $$.axis.getXAxis($$.x, $$.xOrient, $$.xAxisTickFormat, $$.xAxisTickValues, config.axis_x_tick_outer);
        $$.subXAxis = $$.axis.getXAxis($$.subX, $$.subXOrient, $$.xAxisTickFormat, $$.xAxisTickValues, config.axis_x_tick_outer);
        $$.yAxis = $$.axis.getYAxis($$.y, $$.yOrient, config.axis_y_tick_format, $$.yAxisTickValues, config.axis_y_tick_outer);
        $$.y2Axis = $$.axis.getYAxis($$.y2, $$.y2Orient, config.axis_y2_tick_format, $$.y2AxisTickValues, config.axis_y2_tick_outer);

        // Set initialized scales to brush and zoom
        if (!forInit) {
            if ($$.brush) { $$.brush.scale($$.subX); }
            if (config.zoom_enabled) { $$.zoom.scale($$.x); }
        }
        // update for arc
        if ($$.updateArc) { $$.updateArc(); }
    };

    c3_chart_internal_fn.getYDomainMin = function (targets) {
        var $$ = this, config = $$.config,
            ids = $$.mapToIds(targets), ys = $$.getValuesAsIdKeyed(targets),
            j, k, baseId, idsInGroup, id, hasNegativeValue;
        if (config.data_groups.length > 0) {
            hasNegativeValue = $$.hasNegativeValueInTargets(targets);
            for (j = 0; j < config.data_groups.length; j++) {
                // Determine baseId
                idsInGroup = config.data_groups[j].filter(function (id) { return ids.indexOf(id) >= 0; });
                if (idsInGroup.length === 0) { continue; }
                baseId = idsInGroup[0];
                // Consider negative values
                if (hasNegativeValue && ys[baseId]) {
                    ys[baseId].forEach(function (v, i) {
                        ys[baseId][i] = v < 0 ? v : 0;
                    });
                }
                // Compute min
                for (k = 1; k < idsInGroup.length; k++) {
                    id = idsInGroup[k];
                    if (! ys[id]) { continue; }
                    ys[id].forEach(function (v, i) {
                        if ($$.axis.getId(id) === $$.axis.getId(baseId) && ys[baseId] && !(hasNegativeValue && +v > 0)) {
                            ys[baseId][i] += +v;
                        }
                    });
                }
            }
        }
        return $$.d3.min(Object.keys(ys).map(function (key) { return $$.d3.min(ys[key]); }));
    };
    c3_chart_internal_fn.getYDomainMax = function (targets) {
        var $$ = this, config = $$.config,
            ids = $$.mapToIds(targets), ys = $$.getValuesAsIdKeyed(targets),
            j, k, baseId, idsInGroup, id, hasPositiveValue;
        if (config.data_groups.length > 0) {
            hasPositiveValue = $$.hasPositiveValueInTargets(targets);
            for (j = 0; j < config.data_groups.length; j++) {
                // Determine baseId
                idsInGroup = config.data_groups[j].filter(function (id) { return ids.indexOf(id) >= 0; });
                if (idsInGroup.length === 0) { continue; }
                baseId = idsInGroup[0];
                // Consider positive values
                if (hasPositiveValue && ys[baseId]) {
                    ys[baseId].forEach(function (v, i) {
                        ys[baseId][i] = v > 0 ? v : 0;
                    });
                }
                // Compute max
                for (k = 1; k < idsInGroup.length; k++) {
                    id = idsInGroup[k];
                    if (! ys[id]) { continue; }
                    ys[id].forEach(function (v, i) {
                        if ($$.axis.getId(id) === $$.axis.getId(baseId) && ys[baseId] && !(hasPositiveValue && +v < 0)) {
                            ys[baseId][i] += +v;
                        }
                    });
                }
            }
        }
        return $$.d3.max(Object.keys(ys).map(function (key) { return $$.d3.max(ys[key]); }));
    };
    c3_chart_internal_fn.getYDomain = function (targets, axisId, xDomain) {
        var $$ = this, config = $$.config,
            targetsByAxisId = targets.filter(function (t) { return $$.axis.getId(t.id) === axisId; }),
            yTargets = xDomain ? $$.filterByXDomain(targetsByAxisId, xDomain) : targetsByAxisId,
            yMin = axisId === 'y2' ? config.axis_y2_min : config.axis_y_min,
            yMax = axisId === 'y2' ? config.axis_y2_max : config.axis_y_max,
            yDomainMin = $$.getYDomainMin(yTargets),
            yDomainMax = $$.getYDomainMax(yTargets),
            domain, domainLength, padding, padding_top, padding_bottom,
            center = axisId === 'y2' ? config.axis_y2_center : config.axis_y_center,
            yDomainAbs, lengths, diff, ratio, isAllPositive, isAllNegative,
            isZeroBased = ($$.hasType('bar', yTargets) && config.bar_zerobased) || ($$.hasType('area', yTargets) && config.area_zerobased),
            isInverted = axisId === 'y2' ? config.axis_y2_inverted : config.axis_y_inverted,
            showHorizontalDataLabel = $$.hasDataLabel() && config.axis_rotated,
            showVerticalDataLabel = $$.hasDataLabel() && !config.axis_rotated;

        // MEMO: avoid inverting domain unexpectedly
        yDomainMin = isValue(yMin) ? yMin : isValue(yMax) ? (yDomainMin < yMax ? yDomainMin : yMax - 10) : yDomainMin;
        yDomainMax = isValue(yMax) ? yMax : isValue(yMin) ? (yMin < yDomainMax ? yDomainMax : yMin + 10) : yDomainMax;

        if (yTargets.length === 0) { // use current domain if target of axisId is none
            return axisId === 'y2' ? $$.y2.domain() : $$.y.domain();
        }
        if (isNaN(yDomainMin)) { // set minimum to zero when not number
            yDomainMin = 0;
        }
        if (isNaN(yDomainMax)) { // set maximum to have same value as yDomainMin
            yDomainMax = yDomainMin;
        }
        if (yDomainMin === yDomainMax) {
            yDomainMin < 0 ? yDomainMax = 0 : yDomainMin = 0;
        }
        isAllPositive = yDomainMin >= 0 && yDomainMax >= 0;
        isAllNegative = yDomainMin <= 0 && yDomainMax <= 0;

        // Cancel zerobased if axis_*_min / axis_*_max specified
        if ((isValue(yMin) && isAllPositive) || (isValue(yMax) && isAllNegative)) {
            isZeroBased = false;
        }

        // Bar/Area chart should be 0-based if all positive|negative
        if (isZeroBased) {
            if (isAllPositive) { yDomainMin = 0; }
            if (isAllNegative) { yDomainMax = 0; }
        }

        domainLength = Math.abs(yDomainMax - yDomainMin);
        padding = padding_top = padding_bottom = domainLength * 0.1;

        if (typeof center !== 'undefined') {
            yDomainAbs = Math.max(Math.abs(yDomainMin), Math.abs(yDomainMax));
            yDomainMax = center + yDomainAbs;
            yDomainMin = center - yDomainAbs;
        }
        // add padding for data label
        if (showHorizontalDataLabel) {
            lengths = $$.getDataLabelLength(yDomainMin, yDomainMax, 'width');
            diff = diffDomain($$.y.range());
            ratio = [lengths[0] / diff, lengths[1] / diff];
            padding_top += domainLength * (ratio[1] / (1 - ratio[0] - ratio[1]));
            padding_bottom += domainLength * (ratio[0] / (1 - ratio[0] - ratio[1]));
        } else if (showVerticalDataLabel) {
            lengths = $$.getDataLabelLength(yDomainMin, yDomainMax, 'height');
            padding_top += $$.axis.convertPixelsToAxisPadding(lengths[1], domainLength);
            padding_bottom += $$.axis.convertPixelsToAxisPadding(lengths[0], domainLength);
        }
        if (axisId === 'y' && notEmpty(config.axis_y_padding)) {
            padding_top = $$.axis.getPadding(config.axis_y_padding, 'top', padding_top, domainLength);
            padding_bottom = $$.axis.getPadding(config.axis_y_padding, 'bottom', padding_bottom, domainLength);
        }
        if (axisId === 'y2' && notEmpty(config.axis_y2_padding)) {
            padding_top = $$.axis.getPadding(config.axis_y2_padding, 'top', padding_top, domainLength);
            padding_bottom = $$.axis.getPadding(config.axis_y2_padding, 'bottom', padding_bottom, domainLength);
        }
        // Bar/Area chart should be 0-based if all positive|negative
        if (isZeroBased) {
            if (isAllPositive) { padding_bottom = yDomainMin; }
            if (isAllNegative) { padding_top = -yDomainMax; }
        }
        domain = [yDomainMin - padding_bottom, yDomainMax + padding_top];
        return isInverted ? domain.reverse() : domain;
    };
    c3_chart_internal_fn.getXDomainMin = function (targets) {
        var $$ = this, config = $$.config;
        return isDefined(config.axis_x_min) ?
            ($$.isTimeSeries() ? this.parseDate(config.axis_x_min) : config.axis_x_min) :
        $$.d3.min(targets, function (t) { return $$.d3.min(t.values, function (v) { return v.x; }); });
    };
    c3_chart_internal_fn.getXDomainMax = function (targets) {
        var $$ = this, config = $$.config;
        return isDefined(config.axis_x_max) ?
            ($$.isTimeSeries() ? this.parseDate(config.axis_x_max) : config.axis_x_max) :
        $$.d3.max(targets, function (t) { return $$.d3.max(t.values, function (v) { return v.x; }); });
    };
    c3_chart_internal_fn.getXDomainPadding = function (domain) {
        var $$ = this, config = $$.config,
            diff = domain[1] - domain[0],
            maxDataCount, padding, paddingLeft, paddingRight;
        if ($$.isCategorized()) {
            padding = 0;
        } else if ($$.hasType('bar')) {
            maxDataCount = $$.getMaxDataCount();
            padding = maxDataCount > 1 ? (diff / (maxDataCount - 1)) / 2 : 0.5;
        } else {
            padding = diff * 0.01;
        }
        if (typeof config.axis_x_padding === 'object' && notEmpty(config.axis_x_padding)) {
            paddingLeft = isValue(config.axis_x_padding.left) ? config.axis_x_padding.left : padding;
            paddingRight = isValue(config.axis_x_padding.right) ? config.axis_x_padding.right : padding;
        } else if (typeof config.axis_x_padding === 'number') {
            paddingLeft = paddingRight = config.axis_x_padding;
        } else {
            paddingLeft = paddingRight = padding;
        }
        return {left: paddingLeft, right: paddingRight};
    };
    c3_chart_internal_fn.getXDomain = function (targets) {
        var $$ = this,
            xDomain = [$$.getXDomainMin(targets), $$.getXDomainMax(targets)],
            firstX = xDomain[0], lastX = xDomain[1],
            padding = $$.getXDomainPadding(xDomain),
            min = 0, max = 0;
        // show center of x domain if min and max are the same
        if ((firstX - lastX) === 0 && !$$.isCategorized()) {
            if ($$.isTimeSeries()) {
                firstX = new Date(firstX.getTime() * 0.5);
                lastX = new Date(lastX.getTime() * 1.5);
            } else {
                firstX = firstX === 0 ? 1 : (firstX * 0.5);
                lastX = lastX === 0 ? -1 : (lastX * 1.5);
            }
        }
        if (firstX || firstX === 0) {
            min = $$.isTimeSeries() ? new Date(firstX.getTime() - padding.left) : firstX - padding.left;
        }
        if (lastX || lastX === 0) {
            max = $$.isTimeSeries() ? new Date(lastX.getTime() + padding.right) : lastX + padding.right;
        }
        return [min, max];
    };
    c3_chart_internal_fn.updateXDomain = function (targets, withUpdateXDomain, withUpdateOrgXDomain, withTrim, domain) {
        var $$ = this, config = $$.config;

        if (withUpdateOrgXDomain) {
            $$.x.domain(domain ? domain : $$.d3.extent($$.getXDomain(targets)));
            $$.orgXDomain = $$.x.domain();
            if (config.zoom_enabled) { $$.zoom.scale($$.x).updateScaleExtent(); }
            $$.subX.domain($$.x.domain());
            if ($$.brush) { $$.brush.scale($$.subX); }
        }
        if (withUpdateXDomain) {
            $$.x.domain(domain ? domain : (!$$.brush || $$.brush.empty()) ? $$.orgXDomain : $$.brush.extent());
            if (config.zoom_enabled) { $$.zoom.scale($$.x).updateScaleExtent(); }
        }

        // Trim domain when too big by zoom mousemove event
        if (withTrim) { $$.x.domain($$.trimXDomain($$.x.orgDomain())); }

        return $$.x.domain();
    };
    c3_chart_internal_fn.trimXDomain = function (domain) {
        var zoomDomain = this.getZoomDomain(),
            min = zoomDomain[0], max = zoomDomain[1];
        if (domain[0] <= min) {
            domain[1] = +domain[1] + (min - domain[0]);
            domain[0] = min;
        }
        if (max <= domain[1]) {
            domain[0] = +domain[0] - (domain[1] - max);
            domain[1] = max;
        }
        return domain;
    };

    c3_chart_internal_fn.isX = function (key) {
        var $$ = this, config = $$.config;
        return (config.data_x && key === config.data_x) || (notEmpty(config.data_xs) && hasValue(config.data_xs, key));
    };
    c3_chart_internal_fn.isNotX = function (key) {
        return !this.isX(key);
    };
    c3_chart_internal_fn.getXKey = function (id) {
        var $$ = this, config = $$.config;
        return config.data_x ? config.data_x : notEmpty(config.data_xs) ? config.data_xs[id] : null;
    };
    c3_chart_internal_fn.getXValuesOfXKey = function (key, targets) {
        var $$ = this,
            xValues, ids = targets && notEmpty(targets) ? $$.mapToIds(targets) : [];
        ids.forEach(function (id) {
            if ($$.getXKey(id) === key) {
                xValues = $$.data.xs[id];
            }
        });
        return xValues;
    };
    c3_chart_internal_fn.getIndexByX = function (x) {
        var $$ = this,
            data = $$.filterByX($$.data.targets, x);
        return data.length ? data[0].index : null;
    };
    c3_chart_internal_fn.getXValue = function (id, i) {
        var $$ = this;
        return id in $$.data.xs && $$.data.xs[id] && isValue($$.data.xs[id][i]) ? $$.data.xs[id][i] : i;
    };
    c3_chart_internal_fn.getOtherTargetXs = function () {
        var $$ = this,
            idsForX = Object.keys($$.data.xs);
        return idsForX.length ? $$.data.xs[idsForX[0]] : null;
    };
    c3_chart_internal_fn.getOtherTargetX = function (index) {
        var xs = this.getOtherTargetXs();
        return xs && index < xs.length ? xs[index] : null;
    };
    c3_chart_internal_fn.addXs = function (xs) {
        var $$ = this;
        Object.keys(xs).forEach(function (id) {
            $$.config.data_xs[id] = xs[id];
        });
    };
    c3_chart_internal_fn.hasMultipleX = function (xs) {
        return this.d3.set(Object.keys(xs).map(function (id) { return xs[id]; })).size() > 1;
    };
    c3_chart_internal_fn.isMultipleX = function () {
        return notEmpty(this.config.data_xs) || !this.config.data_xSort || this.hasType('scatter');
    };
    c3_chart_internal_fn.addName = function (data) {
        var $$ = this, name;
        if (data) {
            name = $$.config.data_names[data.id];
            data.name = name !== undefined ? name : data.id;
        }
        return data;
    };
    c3_chart_internal_fn.getValueOnIndex = function (values, index) {
        var valueOnIndex = values.filter(function (v) { return v.index === index; });
        return valueOnIndex.length ? valueOnIndex[0] : null;
    };
    c3_chart_internal_fn.updateTargetX = function (targets, x) {
        var $$ = this;
        targets.forEach(function (t) {
            t.values.forEach(function (v, i) {
                v.x = $$.generateTargetX(x[i], t.id, i);
            });
            $$.data.xs[t.id] = x;
        });
    };
    c3_chart_internal_fn.updateTargetXs = function (targets, xs) {
        var $$ = this;
        targets.forEach(function (t) {
            if (xs[t.id]) {
                $$.updateTargetX([t], xs[t.id]);
            }
        });
    };
    c3_chart_internal_fn.generateTargetX = function (rawX, id, index) {
        var $$ = this, x;
        if ($$.isTimeSeries()) {
            x = rawX ? $$.parseDate(rawX) : $$.parseDate($$.getXValue(id, index));
        }
        else if ($$.isCustomX() && !$$.isCategorized()) {
            x = isValue(rawX) ? +rawX : $$.getXValue(id, index);
        }
        else {
            x = index;
        }
        return x;
    };
    c3_chart_internal_fn.cloneTarget = function (target) {
        return {
            id : target.id,
            id_org : target.id_org,
            values : target.values.map(function (d) {
                return {x: d.x, value: d.value, id: d.id};
            })
        };
    };
    c3_chart_internal_fn.updateXs = function () {
        var $$ = this;
        if ($$.data.targets.length) {
            $$.xs = [];
            $$.data.targets[0].values.forEach(function (v) {
                $$.xs[v.index] = v.x;
            });
        }
    };
    c3_chart_internal_fn.getPrevX = function (i) {
        var x = this.xs[i - 1];
        return typeof x !== 'undefined' ? x : null;
    };
    c3_chart_internal_fn.getNextX = function (i) {
        var x = this.xs[i + 1];
        return typeof x !== 'undefined' ? x : null;
    };
    c3_chart_internal_fn.getMaxDataCount = function () {
        var $$ = this;
        return $$.d3.max($$.data.targets, function (t) { return t.values.length; });
    };
    c3_chart_internal_fn.getMaxDataCountTarget = function (targets) {
        var length = targets.length, max = 0, maxTarget;
        if (length > 1) {
            targets.forEach(function (t) {
                if (t.values.length > max) {
                    maxTarget = t;
                    max = t.values.length;
                }
            });
        } else {
            maxTarget = length ? targets[0] : null;
        }
        return maxTarget;
    };
    c3_chart_internal_fn.getEdgeX = function (targets) {
        var $$ = this;
        return !targets.length ? [0, 0] : [
            $$.d3.min(targets, function (t) { return t.values[0].x; }),
            $$.d3.max(targets, function (t) { return t.values[t.values.length - 1].x; })
        ];
    };
    c3_chart_internal_fn.mapToIds = function (targets) {
        return targets.map(function (d) { return d.id; });
    };
    c3_chart_internal_fn.mapToTargetIds = function (ids) {
        var $$ = this;
        return ids ? [].concat(ids) : $$.mapToIds($$.data.targets);
    };
    c3_chart_internal_fn.hasTarget = function (targets, id) {
        var ids = this.mapToIds(targets), i;
        for (i = 0; i < ids.length; i++) {
            if (ids[i] === id) {
                return true;
            }
        }
        return false;
    };
    c3_chart_internal_fn.isTargetToShow = function (targetId) {
        return this.hiddenTargetIds.indexOf(targetId) < 0;
    };
    c3_chart_internal_fn.isLegendToShow = function (targetId) {
        return this.hiddenLegendIds.indexOf(targetId) < 0;
    };
    c3_chart_internal_fn.filterTargetsToShow = function (targets) {
        var $$ = this;
        return targets.filter(function (t) { return $$.isTargetToShow(t.id); });
    };
    c3_chart_internal_fn.mapTargetsToUniqueXs = function (targets) {
        var $$ = this;
        var xs = $$.d3.set($$.d3.merge(targets.map(function (t) { return t.values.map(function (v) { return +v.x; }); }))).values();
        xs = $$.isTimeSeries() ? xs.map(function (x) { return new Date(+x); }) : xs.map(function (x) { return +x; });
        return xs.sort(function (a, b) { return a < b ? -1 : a > b ? 1 : a >= b ? 0 : NaN; });
    };
    c3_chart_internal_fn.addHiddenTargetIds = function (targetIds) {
        this.hiddenTargetIds = this.hiddenTargetIds.concat(targetIds);
    };
    c3_chart_internal_fn.removeHiddenTargetIds = function (targetIds) {
        this.hiddenTargetIds = this.hiddenTargetIds.filter(function (id) { return targetIds.indexOf(id) < 0; });
    };
    c3_chart_internal_fn.addHiddenLegendIds = function (targetIds) {
        this.hiddenLegendIds = this.hiddenLegendIds.concat(targetIds);
    };
    c3_chart_internal_fn.removeHiddenLegendIds = function (targetIds) {
        this.hiddenLegendIds = this.hiddenLegendIds.filter(function (id) { return targetIds.indexOf(id) < 0; });
    };
    c3_chart_internal_fn.getValuesAsIdKeyed = function (targets) {
        var ys = {};
        targets.forEach(function (t) {
            ys[t.id] = [];
            t.values.forEach(function (v) {
                ys[t.id].push(v.value);
            });
        });
        return ys;
    };
    c3_chart_internal_fn.checkValueInTargets = function (targets, checker) {
        var ids = Object.keys(targets), i, j, values;
        for (i = 0; i < ids.length; i++) {
            values = targets[ids[i]].values;
            for (j = 0; j < values.length; j++) {
                if (checker(values[j].value)) {
                    return true;
                }
            }
        }
        return false;
    };
    c3_chart_internal_fn.hasNegativeValueInTargets = function (targets) {
        return this.checkValueInTargets(targets, function (v) { return v < 0; });
    };
    c3_chart_internal_fn.hasPositiveValueInTargets = function (targets) {
        return this.checkValueInTargets(targets, function (v) { return v > 0; });
    };
    c3_chart_internal_fn.isOrderDesc = function () {
        var config = this.config;
        return typeof(config.data_order) === 'string' && config.data_order.toLowerCase() === 'desc';
    };
    c3_chart_internal_fn.isOrderAsc = function () {
        var config = this.config;
        return typeof(config.data_order) === 'string' && config.data_order.toLowerCase() === 'asc';
    };
    c3_chart_internal_fn.orderTargets = function (targets) {
        var $$ = this, config = $$.config, orderAsc = $$.isOrderAsc(), orderDesc = $$.isOrderDesc();
        if (orderAsc || orderDesc) {
            targets.sort(function (t1, t2) {
                var reducer = function (p, c) { return p + Math.abs(c.value); };
                var t1Sum = t1.values.reduce(reducer, 0),
                    t2Sum = t2.values.reduce(reducer, 0);
                return orderAsc ? t2Sum - t1Sum : t1Sum - t2Sum;
            });
        } else if (isFunction(config.data_order)) {
            targets.sort(config.data_order);
        } // TODO: accept name array for order
        return targets;
    };
    c3_chart_internal_fn.filterByX = function (targets, x) {
        return this.d3.merge(targets.map(function (t) { return t.values; })).filter(function (v) { return v.x - x === 0; });
    };
    c3_chart_internal_fn.filterRemoveNull = function (data) {
        return data.filter(function (d) { return isValue(d.value); });
    };
    c3_chart_internal_fn.filterByXDomain = function (targets, xDomain) {
        return targets.map(function (t) {
            return {
                id: t.id,
                id_org: t.id_org,
                values: t.values.filter(function (v) {
                    return xDomain[0] <= v.x && v.x <= xDomain[1];
                })
            };
        });
    };
    c3_chart_internal_fn.hasDataLabel = function () {
        var config = this.config;
        if (typeof config.data_labels === 'boolean' && config.data_labels) {
            return true;
        } else if (typeof config.data_labels === 'object' && notEmpty(config.data_labels)) {
            return true;
        }
        return false;
    };
    c3_chart_internal_fn.getDataLabelLength = function (min, max, key) {
        var $$ = this,
            lengths = [0, 0], paddingCoef = 1.3;
        $$.selectChart.select('svg').selectAll('.dummy')
            .data([min, max])
            .enter().append('text')
            .text(function (d) { return $$.dataLabelFormat(d.id)(d); })
            .each(function (d, i) {
                lengths[i] = this.getBoundingClientRect()[key] * paddingCoef;
            })
            .remove();
        return lengths;
    };
    c3_chart_internal_fn.isNoneArc = function (d) {
        return this.hasTarget(this.data.targets, d.id);
    },
    c3_chart_internal_fn.isArc = function (d) {
        return 'data' in d && this.hasTarget(this.data.targets, d.data.id);
    };
    c3_chart_internal_fn.findSameXOfValues = function (values, index) {
        var i, targetX = values[index].x, sames = [];
        for (i = index - 1; i >= 0; i--) {
            if (targetX !== values[i].x) { break; }
            sames.push(values[i]);
        }
        for (i = index; i < values.length; i++) {
            if (targetX !== values[i].x) { break; }
            sames.push(values[i]);
        }
        return sames;
    };

    c3_chart_internal_fn.findClosestFromTargets = function (targets, pos) {
        var $$ = this, candidates;

        // map to array of closest points of each target
        candidates = targets.map(function (target) {
            return $$.findClosest(target.values, pos);
        });

        // decide closest point and return
        return $$.findClosest(candidates, pos);
    };
    c3_chart_internal_fn.findClosest = function (values, pos) {
        var $$ = this, minDist = $$.config.point_sensitivity, closest;

        // find mouseovering bar
        values.filter(function (v) { return v && $$.isBarType(v.id); }).forEach(function (v) {
            var shape = $$.main.select('.' + CLASS.bars + $$.getTargetSelectorSuffix(v.id) + ' .' + CLASS.bar + '-' + v.index).node();
            if (!closest && $$.isWithinBar(shape)) {
                closest = v;
            }
        });

        // find closest point from non-bar
        values.filter(function (v) { return v && !$$.isBarType(v.id); }).forEach(function (v) {
            var d = $$.dist(v, pos);
            if (d < minDist) {
                minDist = d;
                closest = v;
            }
        });

        return closest;
    };
    c3_chart_internal_fn.dist = function (data, pos) {
        var $$ = this, config = $$.config,
            xIndex = config.axis_rotated ? 1 : 0,
            yIndex = config.axis_rotated ? 0 : 1,
            y = $$.circleY(data, data.index),
            x = $$.x(data.x);
        return Math.sqrt(Math.pow(x - pos[xIndex], 2) + Math.pow(y - pos[yIndex], 2));
    };
    c3_chart_internal_fn.convertValuesToStep = function (values) {
        var converted = [].concat(values), i;

        if (!this.isCategorized()) {
            return values;
        }

        for (i = values.length + 1; 0 < i; i--) {
            converted[i] = converted[i - 1];
        }

        converted[0] = {
            x: converted[0].x - 1,
            value: converted[0].value,
            id: converted[0].id
        };
        converted[values.length + 1] = {
            x: converted[values.length].x + 1,
            value: converted[values.length].value,
            id: converted[values.length].id
        };

        return converted;
    };
    c3_chart_internal_fn.updateDataAttributes = function (name, attrs) {
        var $$ = this, config = $$.config, current = config['data_' + name];
        if (typeof attrs === 'undefined') { return current; }
        Object.keys(attrs).forEach(function (id) {
            current[id] = attrs[id];
        });
        $$.redraw({withLegend: true});
        return current;
    };

    c3_chart_internal_fn.convertUrlToData = function (url, mimeType, headers, keys, done) {
        var $$ = this, type = mimeType ? mimeType : 'csv';
        var req = $$.d3.xhr(url);
        if (headers) {
            Object.keys(headers).forEach(function (header) {
                req.header(header, headers[header]);
            });
        }
        req.get(function (error, data) {
            var d;
            if (!data) {
                throw new Error(error.responseURL + ' ' + error.status + ' (' + error.statusText + ')');
            }
            if (type === 'json') {
                d = $$.convertJsonToData(JSON.parse(data.response), keys);
            } else if (type === 'tsv') {
                d = $$.convertTsvToData(data.response);
            } else {
                d = $$.convertCsvToData(data.response);
            }
            done.call($$, d);
        });
    };
    c3_chart_internal_fn.convertXsvToData = function (xsv, parser) {
        var rows = parser.parseRows(xsv), d;
        if (rows.length === 1) {
            d = [{}];
            rows[0].forEach(function (id) {
                d[0][id] = null;
            });
        } else {
            d = parser.parse(xsv);
        }
        return d;
    };
    c3_chart_internal_fn.convertCsvToData = function (csv) {
        return this.convertXsvToData(csv, this.d3.csv);
    };
    c3_chart_internal_fn.convertTsvToData = function (tsv) {
        return this.convertXsvToData(tsv, this.d3.tsv);
    };
    c3_chart_internal_fn.convertJsonToData = function (json, keys) {
        var $$ = this,
            new_rows = [], targetKeys, data;
        if (keys) { // when keys specified, json would be an array that includes objects
            if (keys.x) {
                targetKeys = keys.value.concat(keys.x);
                $$.config.data_x = keys.x;
            } else {
                targetKeys = keys.value;
            }
            new_rows.push(targetKeys);
            json.forEach(function (o) {
                var new_row = [];
                targetKeys.forEach(function (key) {
                    // convert undefined to null because undefined data will be removed in convertDataToTargets()
                    var v = $$.findValueInJson(o, key);
                    if (isUndefined(v)) {
                        v = null;
                    }
                    new_row.push(v);
                });
                new_rows.push(new_row);
            });
            data = $$.convertRowsToData(new_rows);
        } else {
            Object.keys(json).forEach(function (key) {
                new_rows.push([key].concat(json[key]));
            });
            data = $$.convertColumnsToData(new_rows);
        }
        return data;
    };
    c3_chart_internal_fn.findValueInJson = function (object, path) {
        path = path.replace(/\[(\w+)\]/g, '.$1'); // convert indexes to properties (replace [] with .)
        path = path.replace(/^\./, '');           // strip a leading dot
        var pathArray = path.split('.');
        for (var i = 0; i < pathArray.length; ++i) {
            var k = pathArray[i];
            if (k in object) {
                object = object[k];
            } else {
                return;
            }
        }
        return object;
    };
    c3_chart_internal_fn.convertRowsToData = function (rows) {
        var keys = rows[0], new_row = {}, new_rows = [], i, j;
        for (i = 1; i < rows.length; i++) {
            new_row = {};
            for (j = 0; j < rows[i].length; j++) {
                if (isUndefined(rows[i][j])) {
                    throw new Error("Source data is missing a component at (" + i + "," + j + ")!");
                }
                new_row[keys[j]] = rows[i][j];
            }
            new_rows.push(new_row);
        }
        return new_rows;
    };
    c3_chart_internal_fn.convertColumnsToData = function (columns) {
        var new_rows = [], i, j, key;
        for (i = 0; i < columns.length; i++) {
            key = columns[i][0];
            for (j = 1; j < columns[i].length; j++) {
                if (isUndefined(new_rows[j - 1])) {
                    new_rows[j - 1] = {};
                }
                if (isUndefined(columns[i][j])) {
                    throw new Error("Source data is missing a component at (" + i + "," + j + ")!");
                }
                new_rows[j - 1][key] = columns[i][j];
            }
        }
        return new_rows;
    };
    c3_chart_internal_fn.convertDataToTargets = function (data, appendXs) {
        var $$ = this, config = $$.config,
            ids = $$.d3.keys(data[0]).filter($$.isNotX, $$),
            xs = $$.d3.keys(data[0]).filter($$.isX, $$),
            targets;

        // save x for update data by load when custom x and c3.x API
        ids.forEach(function (id) {
            var xKey = $$.getXKey(id);

            if ($$.isCustomX() || $$.isTimeSeries()) {
                // if included in input data
                if (xs.indexOf(xKey) >= 0) {
                    $$.data.xs[id] = (appendXs && $$.data.xs[id] ? $$.data.xs[id] : []).concat(
                        data.map(function (d) { return d[xKey]; })
                            .filter(isValue)
                            .map(function (rawX, i) { return $$.generateTargetX(rawX, id, i); })
                    );
                }
                // if not included in input data, find from preloaded data of other id's x
                else if (config.data_x) {
                    $$.data.xs[id] = $$.getOtherTargetXs();
                }
                // if not included in input data, find from preloaded data
                else if (notEmpty(config.data_xs)) {
                    $$.data.xs[id] = $$.getXValuesOfXKey(xKey, $$.data.targets);
                }
                // MEMO: if no x included, use same x of current will be used
            } else {
                $$.data.xs[id] = data.map(function (d, i) { return i; });
            }
        });


        // check x is defined
        ids.forEach(function (id) {
            if (!$$.data.xs[id]) {
                throw new Error('x is not defined for id = "' + id + '".');
            }
        });

        // convert to target
        targets = ids.map(function (id, index) {
            var convertedId = config.data_idConverter(id);
            return {
                id: convertedId,
                id_org: id,
                values: data.map(function (d, i) {
                    var xKey = $$.getXKey(id), rawX = d[xKey],
                        value = d[id] !== null && !isNaN(d[id]) ? +d[id] : null, x;
                    // use x as categories if custom x and categorized
                    if ($$.isCustomX() && $$.isCategorized() && index === 0 && !isUndefined(rawX)) {
                        if (index === 0 && i === 0) {
                            config.axis_x_categories = [];
                        }
                        x = config.axis_x_categories.indexOf(rawX);
                        if (x === -1) {
                            x = config.axis_x_categories.length;
                            config.axis_x_categories.push(rawX);
                        }
                    } else {
                        x  = $$.generateTargetX(rawX, id, i);
                    }
                    // mark as x = undefined if value is undefined and filter to remove after mapped
                    if (isUndefined(d[id]) || $$.data.xs[id].length <= i) {
                        x = undefined;
                    }
                    return {x: x, value: value, id: convertedId};
                }).filter(function (v) { return isDefined(v.x); })
            };
        });

        // finish targets
        targets.forEach(function (t) {
            var i;
            // sort values by its x
            if (config.data_xSort) {
                t.values = t.values.sort(function (v1, v2) {
                    var x1 = v1.x || v1.x === 0 ? v1.x : Infinity,
                        x2 = v2.x || v2.x === 0 ? v2.x : Infinity;
                    return x1 - x2;
                });
            }
            // indexing each value
            i = 0;
            t.values.forEach(function (v) {
                v.index = i++;
            });
            // this needs to be sorted because its index and value.index is identical
            $$.data.xs[t.id].sort(function (v1, v2) {
                return v1 - v2;
            });
        });

        // cache information about values
        $$.hasNegativeValue = $$.hasNegativeValueInTargets(targets);
        $$.hasPositiveValue = $$.hasPositiveValueInTargets(targets);

        // set target types
        if (config.data_type) {
            $$.setTargetType($$.mapToIds(targets).filter(function (id) { return ! (id in config.data_types); }), config.data_type);
        }

        // cache as original id keyed
        targets.forEach(function (d) {
            $$.addCache(d.id_org, d);
        });

        return targets;
    };

    c3_chart_internal_fn.load = function (targets, args) {
        var $$ = this;
        if (targets) {
            // filter loading targets if needed
            if (args.filter) {
                targets = targets.filter(args.filter);
            }
            // set type if args.types || args.type specified
            if (args.type || args.types) {
                targets.forEach(function (t) {
                    var type = args.types && args.types[t.id] ? args.types[t.id] : args.type;
                    $$.setTargetType(t.id, type);
                });
            }
            // Update/Add data
            $$.data.targets.forEach(function (d) {
                for (var i = 0; i < targets.length; i++) {
                    if (d.id === targets[i].id) {
                        d.values = targets[i].values;
                        targets.splice(i, 1);
                        break;
                    }
                }
            });
            $$.data.targets = $$.data.targets.concat(targets); // add remained
        }

        // Set targets
        $$.updateTargets($$.data.targets);

        // Redraw with new targets
        $$.redraw({withUpdateOrgXDomain: true, withUpdateXDomain: true, withLegend: true});

        if (args.done) { args.done(); }
    };
    c3_chart_internal_fn.loadFromArgs = function (args) {
        var $$ = this;
        if (args.data) {
            $$.load($$.convertDataToTargets(args.data), args);
        }
        else if (args.url) {
            $$.convertUrlToData(args.url, args.mimeType, args.headers, args.keys, function (data) {
                $$.load($$.convertDataToTargets(data), args);
            });
        }
        else if (args.json) {
            $$.load($$.convertDataToTargets($$.convertJsonToData(args.json, args.keys)), args);
        }
        else if (args.rows) {
            $$.load($$.convertDataToTargets($$.convertRowsToData(args.rows)), args);
        }
        else if (args.columns) {
            $$.load($$.convertDataToTargets($$.convertColumnsToData(args.columns)), args);
        }
        else {
            $$.load(null, args);
        }
    };
    c3_chart_internal_fn.unload = function (targetIds, done) {
        var $$ = this;
        if (!done) {
            done = function () {};
        }
        // filter existing target
        targetIds = targetIds.filter(function (id) { return $$.hasTarget($$.data.targets, id); });
        // If no target, call done and return
        if (!targetIds || targetIds.length === 0) {
            done();
            return;
        }
        $$.svg.selectAll(targetIds.map(function (id) { return $$.selectorTarget(id); }))
            .transition()
            .style('opacity', 0)
            .remove()
            .call($$.endall, done);
        targetIds.forEach(function (id) {
            // Reset fadein for future load
            $$.withoutFadeIn[id] = false;
            // Remove target's elements
            if ($$.legend) {
                $$.legend.selectAll('.' + CLASS.legendItem + $$.getTargetSelectorSuffix(id)).remove();
            }
            // Remove target
            $$.data.targets = $$.data.targets.filter(function (t) {
                return t.id !== id;
            });
        });
    };

    c3_chart_internal_fn.categoryName = function (i) {
        var config = this.config;
        return i < config.axis_x_categories.length ? config.axis_x_categories[i] : i;
    };

    c3_chart_internal_fn.initEventRect = function () {
        var $$ = this;
        $$.main.select('.' + CLASS.chart).append("g")
            .attr("class", CLASS.eventRects)
            .style('fill-opacity', 0);
    };
    c3_chart_internal_fn.redrawEventRect = function () {
        var $$ = this, config = $$.config,
            eventRectUpdate, maxDataCountTarget,
            isMultipleX = $$.isMultipleX();

        // rects for mouseover
        var eventRects = $$.main.select('.' + CLASS.eventRects)
                .style('cursor', config.zoom_enabled ? config.axis_rotated ? 'ns-resize' : 'ew-resize' : null)
                .classed(CLASS.eventRectsMultiple, isMultipleX)
                .classed(CLASS.eventRectsSingle, !isMultipleX);

        // clear old rects
        eventRects.selectAll('.' + CLASS.eventRect).remove();

        // open as public variable
        $$.eventRect = eventRects.selectAll('.' + CLASS.eventRect);

        if (isMultipleX) {
            eventRectUpdate = $$.eventRect.data([0]);
            // enter : only one rect will be added
            $$.generateEventRectsForMultipleXs(eventRectUpdate.enter());
            // update
            $$.updateEventRect(eventRectUpdate);
            // exit : not needed because always only one rect exists
        }
        else {
            // Set data and update $$.eventRect
            maxDataCountTarget = $$.getMaxDataCountTarget($$.data.targets);
            eventRects.datum(maxDataCountTarget ? maxDataCountTarget.values : []);
            $$.eventRect = eventRects.selectAll('.' + CLASS.eventRect);
            eventRectUpdate = $$.eventRect.data(function (d) { return d; });
            // enter
            $$.generateEventRectsForSingleX(eventRectUpdate.enter());
            // update
            $$.updateEventRect(eventRectUpdate);
            // exit
            eventRectUpdate.exit().remove();
        }
    };
    c3_chart_internal_fn.updateEventRect = function (eventRectUpdate) {
        var $$ = this, config = $$.config,
            x, y, w, h, rectW, rectX;

        // set update selection if null
        eventRectUpdate = eventRectUpdate || $$.eventRect.data(function (d) { return d; });

        if ($$.isMultipleX()) {
            // TODO: rotated not supported yet
            x = 0;
            y = 0;
            w = $$.width;
            h = $$.height;
        }
        else {
            if (($$.isCustomX() || $$.isTimeSeries()) && !$$.isCategorized()) {

                // update index for x that is used by prevX and nextX
                $$.updateXs();

                rectW = function (d) {
                    var prevX = $$.getPrevX(d.index), nextX = $$.getNextX(d.index);

                    // if there this is a single data point make the eventRect full width (or height)
                    if (prevX === null && nextX === null) {
                        return config.axis_rotated ? $$.height : $$.width;
                    }

                    if (prevX === null) { prevX = $$.x.domain()[0]; }
                    if (nextX === null) { nextX = $$.x.domain()[1]; }

                    return Math.max(0, ($$.x(nextX) - $$.x(prevX)) / 2);
                };
                rectX = function (d) {
                    var prevX = $$.getPrevX(d.index), nextX = $$.getNextX(d.index),
                        thisX = $$.data.xs[d.id][d.index];

                    // if there this is a single data point position the eventRect at 0
                    if (prevX === null && nextX === null) {
                        return 0;
                    }

                    if (prevX === null) { prevX = $$.x.domain()[0]; }

                    return ($$.x(thisX) + $$.x(prevX)) / 2;
                };
            } else {
                rectW = $$.getEventRectWidth();
                rectX = function (d) {
                    return $$.x(d.x) - (rectW / 2);
                };
            }
            x = config.axis_rotated ? 0 : rectX;
            y = config.axis_rotated ? rectX : 0;
            w = config.axis_rotated ? $$.width : rectW;
            h = config.axis_rotated ? rectW : $$.height;
        }

        eventRectUpdate
            .attr('class', $$.classEvent.bind($$))
            .attr("x", x)
            .attr("y", y)
            .attr("width", w)
            .attr("height", h);
    };
    c3_chart_internal_fn.generateEventRectsForSingleX = function (eventRectEnter) {
        var $$ = this, d3 = $$.d3, config = $$.config;
        eventRectEnter.append("rect")
            .attr("class", $$.classEvent.bind($$))
            .style("cursor", config.data_selection_enabled && config.data_selection_grouped ? "pointer" : null)
            .on('mouseover', function (d) {
                var index = d.index;

                if ($$.dragging || $$.flowing) { return; } // do nothing while dragging/flowing
                if ($$.hasArcType()) { return; }

                // Expand shapes for selection
                if (config.point_focus_expand_enabled) { $$.expandCircles(index, null, true); }
                $$.expandBars(index, null, true);

                // Call event handler
                $$.main.selectAll('.' + CLASS.shape + '-' + index).each(function (d) {
                    config.data_onmouseover.call($$.api, d);
                });
            })
            .on('mouseout', function (d) {
                var index = d.index;
                if (!$$.config) { return; } // chart is destroyed
                if ($$.hasArcType()) { return; }
                $$.hideXGridFocus();
                $$.hideTooltip();
                // Undo expanded shapes
                $$.unexpandCircles();
                $$.unexpandBars();
                // Call event handler
                $$.main.selectAll('.' + CLASS.shape + '-' + index).each(function (d) {
                    config.data_onmouseout.call($$.api, d);
                });
            })
            .on('mousemove', function (d) {
                var selectedData, index = d.index,
                    eventRect = $$.svg.select('.' + CLASS.eventRect + '-' + index);

                if ($$.dragging || $$.flowing) { return; } // do nothing while dragging/flowing
                if ($$.hasArcType()) { return; }

                if ($$.isStepType(d) && $$.config.line_step_type === 'step-after' && d3.mouse(this)[0] < $$.x($$.getXValue(d.id, index))) {
                    index -= 1;
                }

                // Show tooltip
                selectedData = $$.filterTargetsToShow($$.data.targets).map(function (t) {
                    return $$.addName($$.getValueOnIndex(t.values, index));
                });

                if (config.tooltip_grouped) {
                    $$.showTooltip(selectedData, this);
                    $$.showXGridFocus(selectedData);
                }

                if (config.tooltip_grouped && (!config.data_selection_enabled || config.data_selection_grouped)) {
                    return;
                }

                $$.main.selectAll('.' + CLASS.shape + '-' + index)
                    .each(function () {
                        d3.select(this).classed(CLASS.EXPANDED, true);
                        if (config.data_selection_enabled) {
                            eventRect.style('cursor', config.data_selection_grouped ? 'pointer' : null);
                        }
                        if (!config.tooltip_grouped) {
                            $$.hideXGridFocus();
                            $$.hideTooltip();
                            if (!config.data_selection_grouped) {
                                $$.unexpandCircles(index);
                                $$.unexpandBars(index);
                            }
                        }
                    })
                    .filter(function (d) {
                        return $$.isWithinShape(this, d);
                    })
                    .each(function (d) {
                        if (config.data_selection_enabled && (config.data_selection_grouped || config.data_selection_isselectable(d))) {
                            eventRect.style('cursor', 'pointer');
                        }
                        if (!config.tooltip_grouped) {
                            $$.showTooltip([d], this);
                            $$.showXGridFocus([d]);
                            if (config.point_focus_expand_enabled) { $$.expandCircles(index, d.id, true); }
                            $$.expandBars(index, d.id, true);
                        }
                    });
            })
            .on('click', function (d) {
                var index = d.index;
                if ($$.hasArcType() || !$$.toggleShape) { return; }
                if ($$.cancelClick) {
                    $$.cancelClick = false;
                    return;
                }
                if ($$.isStepType(d) && config.line_step_type === 'step-after' && d3.mouse(this)[0] < $$.x($$.getXValue(d.id, index))) {
                    index -= 1;
                }
                $$.main.selectAll('.' + CLASS.shape + '-' + index).each(function (d) {
                    if (config.data_selection_grouped || $$.isWithinShape(this, d)) {
                        $$.toggleShape(this, d, index);
                        $$.config.data_onclick.call($$.api, d, this);
                    }
                });
            })
            .call(
                config.data_selection_draggable && $$.drag ? (
                    d3.behavior.drag().origin(Object)
                        .on('drag', function () { $$.drag(d3.mouse(this)); })
                        .on('dragstart', function () { $$.dragstart(d3.mouse(this)); })
                        .on('dragend', function () { $$.dragend(); })
                ) : function () {}
            );
    };

    c3_chart_internal_fn.generateEventRectsForMultipleXs = function (eventRectEnter) {
        var $$ = this, d3 = $$.d3, config = $$.config;

        function mouseout() {
            $$.svg.select('.' + CLASS.eventRect).style('cursor', null);
            $$.hideXGridFocus();
            $$.hideTooltip();
            $$.unexpandCircles();
            $$.unexpandBars();
        }

        eventRectEnter.append('rect')
            .attr('x', 0)
            .attr('y', 0)
            .attr('width', $$.width)
            .attr('height', $$.height)
            .attr('class', CLASS.eventRect)
            .on('mouseout', function () {
                if (!$$.config) { return; } // chart is destroyed
                if ($$.hasArcType()) { return; }
                mouseout();
            })
            .on('mousemove', function () {
                var targetsToShow = $$.filterTargetsToShow($$.data.targets);
                var mouse, closest, sameXData, selectedData;

                if ($$.dragging) { return; } // do nothing when dragging
                if ($$.hasArcType(targetsToShow)) { return; }

                mouse = d3.mouse(this);
                closest = $$.findClosestFromTargets(targetsToShow, mouse);

                if ($$.mouseover && (!closest || closest.id !== $$.mouseover.id)) {
                    config.data_onmouseout.call($$.api, $$.mouseover);
                    $$.mouseover = undefined;
                }

                if (! closest) {
                    mouseout();
                    return;
                }

                if ($$.isScatterType(closest) || !config.tooltip_grouped) {
                    sameXData = [closest];
                } else {
                    sameXData = $$.filterByX(targetsToShow, closest.x);
                }

                // show tooltip when cursor is close to some point
                selectedData = sameXData.map(function (d) {
                    return $$.addName(d);
                });
                $$.showTooltip(selectedData, this);

                // expand points
                if (config.point_focus_expand_enabled) {
                    $$.expandCircles(closest.index, closest.id, true);
                }
                $$.expandBars(closest.index, closest.id, true);

                // Show xgrid focus line
                $$.showXGridFocus(selectedData);

                // Show cursor as pointer if point is close to mouse position
                if ($$.isBarType(closest.id) || $$.dist(closest, mouse) < config.point_sensitivity) {
                    $$.svg.select('.' + CLASS.eventRect).style('cursor', 'pointer');
                    if (!$$.mouseover) {
                        config.data_onmouseover.call($$.api, closest);
                        $$.mouseover = closest;
                    }
                }
            })
            .on('click', function () {
                var targetsToShow = $$.filterTargetsToShow($$.data.targets);
                var mouse, closest;
                if ($$.hasArcType(targetsToShow)) { return; }

                mouse = d3.mouse(this);
                closest = $$.findClosestFromTargets(targetsToShow, mouse);
                if (! closest) { return; }
                // select if selection enabled
                if ($$.isBarType(closest.id) || $$.dist(closest, mouse) < config.point_sensitivity) {
                    $$.main.selectAll('.' + CLASS.shapes + $$.getTargetSelectorSuffix(closest.id)).selectAll('.' + CLASS.shape + '-' + closest.index).each(function () {
                        if (config.data_selection_grouped || $$.isWithinShape(this, closest)) {
                            $$.toggleShape(this, closest, closest.index);
                            $$.config.data_onclick.call($$.api, closest, this);
                        }
                    });
                }
            })
            .call(
                config.data_selection_draggable && $$.drag ? (
                    d3.behavior.drag().origin(Object)
                        .on('drag', function () { $$.drag(d3.mouse(this)); })
                        .on('dragstart', function () { $$.dragstart(d3.mouse(this)); })
                        .on('dragend', function () { $$.dragend(); })
                ) : function () {}
            );
    };
    c3_chart_internal_fn.dispatchEvent = function (type, index, mouse) {
        var $$ = this,
            selector = '.' + CLASS.eventRect + (!$$.isMultipleX() ? '-' + index : ''),
            eventRect = $$.main.select(selector).node(),
            box = eventRect.getBoundingClientRect(),
            x = box.left + (mouse ? mouse[0] : 0),
            y = box.top + (mouse ? mouse[1] : 0),
            event = document.createEvent("MouseEvents");

        event.initMouseEvent(type, true, true, window, 0, x, y, x, y,
                             false, false, false, false, 0, null);
        eventRect.dispatchEvent(event);
    };

    c3_chart_internal_fn.getCurrentWidth = function () {
        var $$ = this, config = $$.config;
        return config.size_width ? config.size_width : $$.getParentWidth();
    };
    c3_chart_internal_fn.getCurrentHeight = function () {
        var $$ = this, config = $$.config,
            h = config.size_height ? config.size_height : $$.getParentHeight();
        return h > 0 ? h : 320 / ($$.hasType('gauge') && !config.gauge_fullCircle ? 2 : 1);
    };
    c3_chart_internal_fn.getCurrentPaddingTop = function () {
        var $$ = this,
            config = $$.config,
            padding = isValue(config.padding_top) ? config.padding_top : 0;
        if ($$.title && $$.title.node()) {
            padding += $$.getTitlePadding();
        }
        return padding;
    };
    c3_chart_internal_fn.getCurrentPaddingBottom = function () {
        var config = this.config;
        return isValue(config.padding_bottom) ? config.padding_bottom : 0;
    };
    c3_chart_internal_fn.getCurrentPaddingLeft = function (withoutRecompute) {
        var $$ = this, config = $$.config;
        if (isValue(config.padding_left)) {
            return config.padding_left;
        } else if (config.axis_rotated) {
            return !config.axis_x_show ? 1 : Math.max(ceil10($$.getAxisWidthByAxisId('x', withoutRecompute)), 40);
        } else if (!config.axis_y_show || config.axis_y_inner) { // && !config.axis_rotated
            return $$.axis.getYAxisLabelPosition().isOuter ? 30 : 1;
        } else {
            return ceil10($$.getAxisWidthByAxisId('y', withoutRecompute));
        }
    };
    c3_chart_internal_fn.getCurrentPaddingRight = function () {
        var $$ = this, config = $$.config,
            defaultPadding = 10, legendWidthOnRight = $$.isLegendRight ? $$.getLegendWidth() + 20 : 0;
        if (isValue(config.padding_right)) {
            return config.padding_right + 1; // 1 is needed not to hide tick line
        } else if (config.axis_rotated) {
            return defaultPadding + legendWidthOnRight;
        } else if (!config.axis_y2_show || config.axis_y2_inner) { // && !config.axis_rotated
            return 2 + legendWidthOnRight + ($$.axis.getY2AxisLabelPosition().isOuter ? 20 : 0);
        } else {
            return ceil10($$.getAxisWidthByAxisId('y2')) + legendWidthOnRight;
        }
    };

    c3_chart_internal_fn.getParentRectValue = function (key) {
        var parent = this.selectChart.node(), v;
        while (parent && parent.tagName !== 'BODY') {
            try {
                v = parent.getBoundingClientRect()[key];
            } catch(e) {
                if (key === 'width') {
                    // In IE in certain cases getBoundingClientRect
                    // will cause an "unspecified error"
                    v = parent.offsetWidth;
                }
            }
            if (v) {
                break;
            }
            parent = parent.parentNode;
        }
        return v;
    };
    c3_chart_internal_fn.getParentWidth = function () {
        return this.getParentRectValue('width');
    };
    c3_chart_internal_fn.getParentHeight = function () {
        var h = this.selectChart.style('height');
        return h.indexOf('px') > 0 ? +h.replace('px', '') : 0;
    };


    c3_chart_internal_fn.getSvgLeft = function (withoutRecompute) {
        var $$ = this, config = $$.config,
            hasLeftAxisRect = config.axis_rotated || (!config.axis_rotated && !config.axis_y_inner),
            leftAxisClass = config.axis_rotated ? CLASS.axisX : CLASS.axisY,
            leftAxis = $$.main.select('.' + leftAxisClass).node(),
            svgRect = leftAxis && hasLeftAxisRect ? leftAxis.getBoundingClientRect() : {right: 0},
            chartRect = $$.selectChart.node().getBoundingClientRect(),
            hasArc = $$.hasArcType(),
            svgLeft = svgRect.right - chartRect.left - (hasArc ? 0 : $$.getCurrentPaddingLeft(withoutRecompute));
        return svgLeft > 0 ? svgLeft : 0;
    };


    c3_chart_internal_fn.getAxisWidthByAxisId = function (id, withoutRecompute) {
        var $$ = this, position = $$.axis.getLabelPositionById(id);
        return $$.axis.getMaxTickWidth(id, withoutRecompute) + (position.isInner ? 20 : 40);
    };
    c3_chart_internal_fn.getHorizontalAxisHeight = function (axisId) {
        var $$ = this, config = $$.config, h = 30;
        if (axisId === 'x' && !config.axis_x_show) { return 8; }
        if (axisId === 'x' && config.axis_x_height) { return config.axis_x_height; }
        if (axisId === 'y' && !config.axis_y_show) {
            return config.legend_show && !$$.isLegendRight && !$$.isLegendInset ? 10 : 1;
        }
        if (axisId === 'y2' && !config.axis_y2_show) { return $$.rotated_padding_top; }
        // Calculate x axis height when tick rotated
        if (axisId === 'x' && !config.axis_rotated && config.axis_x_tick_rotate) {
            h = 30 + $$.axis.getMaxTickWidth(axisId) * Math.cos(Math.PI * (90 - config.axis_x_tick_rotate) / 180);
        }
        // Calculate y axis height when tick rotated
        if (axisId === 'y' && config.axis_rotated && config.axis_y_tick_rotate) {
            h = 30 + $$.axis.getMaxTickWidth(axisId) * Math.cos(Math.PI * (90 - config.axis_y_tick_rotate) / 180);
        }
        return h + ($$.axis.getLabelPositionById(axisId).isInner ? 0 : 10) + (axisId === 'y2' ? -10 : 0);
    };

    c3_chart_internal_fn.getEventRectWidth = function () {
        return Math.max(0, this.xAxis.tickInterval());
    };

    c3_chart_internal_fn.getShapeIndices = function (typeFilter) {
        var $$ = this, config = $$.config,
            indices = {}, i = 0, j, k;
        $$.filterTargetsToShow($$.data.targets.filter(typeFilter, $$)).forEach(function (d) {
            for (j = 0; j < config.data_groups.length; j++) {
                if (config.data_groups[j].indexOf(d.id) < 0) { continue; }
                for (k = 0; k < config.data_groups[j].length; k++) {
                    if (config.data_groups[j][k] in indices) {
                        indices[d.id] = indices[config.data_groups[j][k]];
                        break;
                    }
                }
            }
            if (isUndefined(indices[d.id])) { indices[d.id] = i++; }
        });
        indices.__max__ = i - 1;
        return indices;
    };
    c3_chart_internal_fn.getShapeX = function (offset, targetsNum, indices, isSub) {
        var $$ = this, scale = isSub ? $$.subX : $$.x;
        return function (d) {
            var index = d.id in indices ? indices[d.id] : 0;
            return d.x || d.x === 0 ? scale(d.x) - offset * (targetsNum / 2 - index) : 0;
        };
    };
    c3_chart_internal_fn.getShapeY = function (isSub) {
        var $$ = this;
        return function (d) {
            var scale = isSub ? $$.getSubYScale(d.id) : $$.getYScale(d.id);
            return scale(d.value);
        };
    };
    c3_chart_internal_fn.getShapeOffset = function (typeFilter, indices, isSub) {
        var $$ = this,
            targets = $$.orderTargets($$.filterTargetsToShow($$.data.targets.filter(typeFilter, $$))),
            targetIds = targets.map(function (t) { return t.id; });
        return function (d, i) {
            var scale = isSub ? $$.getSubYScale(d.id) : $$.getYScale(d.id),
                y0 = scale(0), offset = y0;
            targets.forEach(function (t) {
                var values = $$.isStepType(d) ? $$.convertValuesToStep(t.values) : t.values;
                if (t.id === d.id || indices[t.id] !== indices[d.id]) { return; }
                if (targetIds.indexOf(t.id) < targetIds.indexOf(d.id)) {
                    // check if the x values line up
                    if (typeof values[i] === 'undefined' || +values[i].x !== +d.x) {  // "+" for timeseries
                        // if not, try to find the value that does line up
                        i = -1;
                        values.forEach(function (v, j) {
                            if (v.x === d.x) {
                                i = j;
                            }
                        });
                    }
                    if (i in values && values[i].value * d.value >= 0) {
                        offset += scale(values[i].value) - y0;
                    }
                }
            });
            return offset;
        };
    };
    c3_chart_internal_fn.isWithinShape = function (that, d) {
        var $$ = this,
            shape = $$.d3.select(that), isWithin;
        if (!$$.isTargetToShow(d.id)) {
            isWithin = false;
        }
        else if (that.nodeName === 'circle') {
            isWithin = $$.isStepType(d) ? $$.isWithinStep(that, $$.getYScale(d.id)(d.value)) : $$.isWithinCircle(that, $$.pointSelectR(d) * 1.5);
        }
        else if (that.nodeName === 'path') {
            isWithin = shape.classed(CLASS.bar) ? $$.isWithinBar(that) : true;
        }
        return isWithin;
    };


    c3_chart_internal_fn.getInterpolate = function (d) {
        var $$ = this,
            interpolation = $$.isInterpolationType($$.config.spline_interpolation_type) ? $$.config.spline_interpolation_type : 'cardinal';
        return $$.isSplineType(d) ? interpolation : $$.isStepType(d) ? $$.config.line_step_type : "linear";
    };

    c3_chart_internal_fn.initLine = function () {
        var $$ = this;
        $$.main.select('.' + CLASS.chart).append("g")
            .attr("class", CLASS.chartLines);
    };
    c3_chart_internal_fn.updateTargetsForLine = function (targets) {
        var $$ = this, config = $$.config,
            mainLineUpdate, mainLineEnter,
            classChartLine = $$.classChartLine.bind($$),
            classLines = $$.classLines.bind($$),
            classAreas = $$.classAreas.bind($$),
            classCircles = $$.classCircles.bind($$),
            classFocus = $$.classFocus.bind($$);
        mainLineUpdate = $$.main.select('.' + CLASS.chartLines).selectAll('.' + CLASS.chartLine)
            .data(targets)
            .attr('class', function (d) { return classChartLine(d) + classFocus(d); });
        mainLineEnter = mainLineUpdate.enter().append('g')
            .attr('class', classChartLine)
            .style('opacity', 0)
            .style("pointer-events", "none");
        // Lines for each data
        mainLineEnter.append('g')
            .attr("class", classLines);
        // Areas
        mainLineEnter.append('g')
            .attr('class', classAreas);
        // Circles for each data point on lines
        mainLineEnter.append('g')
            .attr("class", function (d) { return $$.generateClass(CLASS.selectedCircles, d.id); });
        mainLineEnter.append('g')
            .attr("class", classCircles)
            .style("cursor", function (d) { return config.data_selection_isselectable(d) ? "pointer" : null; });
        // Update date for selected circles
        targets.forEach(function (t) {
            $$.main.selectAll('.' + CLASS.selectedCircles + $$.getTargetSelectorSuffix(t.id)).selectAll('.' + CLASS.selectedCircle).each(function (d) {
                d.value = t.values[d.index].value;
            });
        });
        // MEMO: can not keep same color...
        //mainLineUpdate.exit().remove();
    };
    c3_chart_internal_fn.updateLine = function (durationForExit) {
        var $$ = this;
        $$.mainLine = $$.main.selectAll('.' + CLASS.lines).selectAll('.' + CLASS.line)
            .data($$.lineData.bind($$));
        $$.mainLine.enter().append('path')
            .attr('class', $$.classLine.bind($$))
            .style("stroke", $$.color);
        $$.mainLine
            .style("opacity", $$.initialOpacity.bind($$))
            .style('shape-rendering', function (d) { return $$.isStepType(d) ? 'crispEdges' : ''; })
            .attr('transform', null);
        $$.mainLine.exit().transition().duration(durationForExit)
            .style('opacity', 0)
            .remove();
    };
    c3_chart_internal_fn.redrawLine = function (drawLine, withTransition) {
        return [
            (withTransition ? this.mainLine.transition(Math.random().toString()) : this.mainLine)
                .attr("d", drawLine)
                .style("stroke", this.color)
                .style("opacity", 1)
        ];
    };
    c3_chart_internal_fn.generateDrawLine = function (lineIndices, isSub) {
        var $$ = this, config = $$.config,
            line = $$.d3.svg.line(),
            getPoints = $$.generateGetLinePoints(lineIndices, isSub),
            yScaleGetter = isSub ? $$.getSubYScale : $$.getYScale,
            xValue = function (d) { return (isSub ? $$.subxx : $$.xx).call($$, d); },
            yValue = function (d, i) {
                return config.data_groups.length > 0 ? getPoints(d, i)[0][1] : yScaleGetter.call($$, d.id)(d.value);
            };

        line = config.axis_rotated ? line.x(yValue).y(xValue) : line.x(xValue).y(yValue);
        if (!config.line_connectNull) { line = line.defined(function (d) { return d.value != null; }); }
        return function (d) {
            var values = config.line_connectNull ? $$.filterRemoveNull(d.values) : d.values,
                x = isSub ? $$.x : $$.subX, y = yScaleGetter.call($$, d.id), x0 = 0, y0 = 0, path;
            if ($$.isLineType(d)) {
                if (config.data_regions[d.id]) {
                    path = $$.lineWithRegions(values, x, y, config.data_regions[d.id]);
                } else {
                    if ($$.isStepType(d)) { values = $$.convertValuesToStep(values); }
                    path = line.interpolate($$.getInterpolate(d))(values);
                }
            } else {
                if (values[0]) {
                    x0 = x(values[0].x);
                    y0 = y(values[0].value);
                }
                path = config.axis_rotated ? "M " + y0 + " " + x0 : "M " + x0 + " " + y0;
            }
            return path ? path : "M 0 0";
        };
    };
    c3_chart_internal_fn.generateGetLinePoints = function (lineIndices, isSub) { // partial duplication of generateGetBarPoints
        var $$ = this, config = $$.config,
            lineTargetsNum = lineIndices.__max__ + 1,
            x = $$.getShapeX(0, lineTargetsNum, lineIndices, !!isSub),
            y = $$.getShapeY(!!isSub),
            lineOffset = $$.getShapeOffset($$.isLineType, lineIndices, !!isSub),
            yScale = isSub ? $$.getSubYScale : $$.getYScale;
        return function (d, i) {
            var y0 = yScale.call($$, d.id)(0),
                offset = lineOffset(d, i) || y0, // offset is for stacked area chart
                posX = x(d), posY = y(d);
            // fix posY not to overflow opposite quadrant
            if (config.axis_rotated) {
                if ((0 < d.value && posY < y0) || (d.value < 0 && y0 < posY)) { posY = y0; }
            }
            // 1 point that marks the line position
            return [
                [posX, posY - (y0 - offset)],
                [posX, posY - (y0 - offset)], // needed for compatibility
                [posX, posY - (y0 - offset)], // needed for compatibility
                [posX, posY - (y0 - offset)]  // needed for compatibility
            ];
        };
    };


    c3_chart_internal_fn.lineWithRegions = function (d, x, y, _regions) {
        var $$ = this, config = $$.config,
            prev = -1, i, j,
            s = "M", sWithRegion,
            xp, yp, dx, dy, dd, diff, diffx2,
            xOffset = $$.isCategorized() ? 0.5 : 0,
            xValue, yValue,
            regions = [];

        function isWithinRegions(x, regions) {
            var i;
            for (i = 0; i < regions.length; i++) {
                if (regions[i].start < x && x <= regions[i].end) { return true; }
            }
            return false;
        }

        // Check start/end of regions
        if (isDefined(_regions)) {
            for (i = 0; i < _regions.length; i++) {
                regions[i] = {};
                if (isUndefined(_regions[i].start)) {
                    regions[i].start = d[0].x;
                } else {
                    regions[i].start = $$.isTimeSeries() ? $$.parseDate(_regions[i].start) : _regions[i].start;
                }
                if (isUndefined(_regions[i].end)) {
                    regions[i].end = d[d.length - 1].x;
                } else {
                    regions[i].end = $$.isTimeSeries() ? $$.parseDate(_regions[i].end) : _regions[i].end;
                }
            }
        }

        // Set scales
        xValue = config.axis_rotated ? function (d) { return y(d.value); } : function (d) { return x(d.x); };
        yValue = config.axis_rotated ? function (d) { return x(d.x); } : function (d) { return y(d.value); };

        // Define svg generator function for region
        function generateM(points) {
            return 'M' + points[0][0] + ' ' + points[0][1] + ' ' + points[1][0] + ' ' + points[1][1];
        }
        if ($$.isTimeSeries()) {
            sWithRegion = function (d0, d1, j, diff) {
                var x0 = d0.x.getTime(), x_diff = d1.x - d0.x,
                    xv0 = new Date(x0 + x_diff * j),
                    xv1 = new Date(x0 + x_diff * (j + diff)),
                    points;
                if (config.axis_rotated) {
                    points = [[y(yp(j)), x(xv0)], [y(yp(j + diff)), x(xv1)]];
                } else {
                    points = [[x(xv0), y(yp(j))], [x(xv1), y(yp(j + diff))]];
                }
                return generateM(points);
            };
        } else {
            sWithRegion = function (d0, d1, j, diff) {
                var points;
                if (config.axis_rotated) {
                    points = [[y(yp(j), true), x(xp(j))], [y(yp(j + diff), true), x(xp(j + diff))]];
                } else {
                    points = [[x(xp(j), true), y(yp(j))], [x(xp(j + diff), true), y(yp(j + diff))]];
                }
                return generateM(points);
            };
        }

        // Generate
        for (i = 0; i < d.length; i++) {

            // Draw as normal
            if (isUndefined(regions) || ! isWithinRegions(d[i].x, regions)) {
                s += " " + xValue(d[i]) + " " + yValue(d[i]);
            }
            // Draw with region // TODO: Fix for horizotal charts
            else {
                xp = $$.getScale(d[i - 1].x + xOffset, d[i].x + xOffset, $$.isTimeSeries());
                yp = $$.getScale(d[i - 1].value, d[i].value);

                dx = x(d[i].x) - x(d[i - 1].x);
                dy = y(d[i].value) - y(d[i - 1].value);
                dd = Math.sqrt(Math.pow(dx, 2) + Math.pow(dy, 2));
                diff = 2 / dd;
                diffx2 = diff * 2;

                for (j = diff; j <= 1; j += diffx2) {
                    s += sWithRegion(d[i - 1], d[i], j, diff);
                }
            }
            prev = d[i].x;
        }

        return s;
    };


    c3_chart_internal_fn.updateArea = function (durationForExit) {
        var $$ = this, d3 = $$.d3;
        $$.mainArea = $$.main.selectAll('.' + CLASS.areas).selectAll('.' + CLASS.area)
            .data($$.lineData.bind($$));
        $$.mainArea.enter().append('path')
            .attr("class", $$.classArea.bind($$))
            .style("fill", $$.color)
            .style("opacity", function () { $$.orgAreaOpacity = +d3.select(this).style('opacity'); return 0; });
        $$.mainArea
            .style("opacity", $$.orgAreaOpacity);
        $$.mainArea.exit().transition().duration(durationForExit)
            .style('opacity', 0)
            .remove();
    };
    c3_chart_internal_fn.redrawArea = function (drawArea, withTransition) {
        return [
            (withTransition ? this.mainArea.transition(Math.random().toString()) : this.mainArea)
                .attr("d", drawArea)
                .style("fill", this.color)
                .style("opacity", this.orgAreaOpacity)
        ];
    };
    c3_chart_internal_fn.generateDrawArea = function (areaIndices, isSub) {
        var $$ = this, config = $$.config, area = $$.d3.svg.area(),
            getPoints = $$.generateGetAreaPoints(areaIndices, isSub),
            yScaleGetter = isSub ? $$.getSubYScale : $$.getYScale,
            xValue = function (d) { return (isSub ? $$.subxx : $$.xx).call($$, d); },
            value0 = function (d, i) {
                return config.data_groups.length > 0 ? getPoints(d, i)[0][1] : yScaleGetter.call($$, d.id)($$.getAreaBaseValue(d.id));
            },
            value1 = function (d, i) {
                return config.data_groups.length > 0 ? getPoints(d, i)[1][1] : yScaleGetter.call($$, d.id)(d.value);
            };

        area = config.axis_rotated ? area.x0(value0).x1(value1).y(xValue) : area.x(xValue).y0(config.area_above ? 0 : value0).y1(value1);
        if (!config.line_connectNull) {
            area = area.defined(function (d) { return d.value !== null; });
        }

        return function (d) {
            var values = config.line_connectNull ? $$.filterRemoveNull(d.values) : d.values,
                x0 = 0, y0 = 0, path;
            if ($$.isAreaType(d)) {
                if ($$.isStepType(d)) { values = $$.convertValuesToStep(values); }
                path = area.interpolate($$.getInterpolate(d))(values);
            } else {
                if (values[0]) {
                    x0 = $$.x(values[0].x);
                    y0 = $$.getYScale(d.id)(values[0].value);
                }
                path = config.axis_rotated ? "M " + y0 + " " + x0 : "M " + x0 + " " + y0;
            }
            return path ? path : "M 0 0";
        };
    };
    c3_chart_internal_fn.getAreaBaseValue = function () {
        return 0;
    };
    c3_chart_internal_fn.generateGetAreaPoints = function (areaIndices, isSub) { // partial duplication of generateGetBarPoints
        var $$ = this, config = $$.config,
            areaTargetsNum = areaIndices.__max__ + 1,
            x = $$.getShapeX(0, areaTargetsNum, areaIndices, !!isSub),
            y = $$.getShapeY(!!isSub),
            areaOffset = $$.getShapeOffset($$.isAreaType, areaIndices, !!isSub),
            yScale = isSub ? $$.getSubYScale : $$.getYScale;
        return function (d, i) {
            var y0 = yScale.call($$, d.id)(0),
                offset = areaOffset(d, i) || y0, // offset is for stacked area chart
                posX = x(d), posY = y(d);
            // fix posY not to overflow opposite quadrant
            if (config.axis_rotated) {
                if ((0 < d.value && posY < y0) || (d.value < 0 && y0 < posY)) { posY = y0; }
            }
            // 1 point that marks the area position
            return [
                [posX, offset],
                [posX, posY - (y0 - offset)],
                [posX, posY - (y0 - offset)], // needed for compatibility
                [posX, offset] // needed for compatibility
            ];
        };
    };


    c3_chart_internal_fn.updateCircle = function () {
        var $$ = this;
        $$.mainCircle = $$.main.selectAll('.' + CLASS.circles).selectAll('.' + CLASS.circle)
            .data($$.lineOrScatterData.bind($$));
        $$.mainCircle.enter().append("circle")
            .attr("class", $$.classCircle.bind($$))
            .attr("r", $$.pointR.bind($$))
            .style("fill", $$.color);
        $$.mainCircle
            .style("opacity", $$.initialOpacityForCircle.bind($$));
        $$.mainCircle.exit().remove();
    };
    c3_chart_internal_fn.redrawCircle = function (cx, cy, withTransition) {
        var selectedCircles = this.main.selectAll('.' + CLASS.selectedCircle);
        return [
            (withTransition ? this.mainCircle.transition(Math.random().toString()) : this.mainCircle)
                .style('opacity', this.opacityForCircle.bind(this))
                .style("fill", this.color)
                .attr("cx", cx)
                .attr("cy", cy),
            (withTransition ? selectedCircles.transition(Math.random().toString()) : selectedCircles)
                .attr("cx", cx)
                .attr("cy", cy)
        ];
    };
    c3_chart_internal_fn.circleX = function (d) {
        return d.x || d.x === 0 ? this.x(d.x) : null;
    };
    c3_chart_internal_fn.updateCircleY = function () {
        var $$ = this, lineIndices, getPoints;
        if ($$.config.data_groups.length > 0) {
            lineIndices = $$.getShapeIndices($$.isLineType),
            getPoints = $$.generateGetLinePoints(lineIndices);
            $$.circleY = function (d, i) {
                return getPoints(d, i)[0][1];
            };
        } else {
            $$.circleY = function (d) {
                return $$.getYScale(d.id)(d.value);
            };
        }
    };
    c3_chart_internal_fn.getCircles = function (i, id) {
        var $$ = this;
        return (id ? $$.main.selectAll('.' + CLASS.circles + $$.getTargetSelectorSuffix(id)) : $$.main).selectAll('.' + CLASS.circle + (isValue(i) ? '-' + i : ''));
    };
    c3_chart_internal_fn.expandCircles = function (i, id, reset) {
        var $$ = this,
            r = $$.pointExpandedR.bind($$);
        if (reset) { $$.unexpandCircles(); }
        $$.getCircles(i, id)
            .classed(CLASS.EXPANDED, true)
            .attr('r', r);
    };
    c3_chart_internal_fn.unexpandCircles = function (i) {
        var $$ = this,
            r = $$.pointR.bind($$);
        $$.getCircles(i)
            .filter(function () { return $$.d3.select(this).classed(CLASS.EXPANDED); })
            .classed(CLASS.EXPANDED, false)
            .attr('r', r);
    };
    c3_chart_internal_fn.pointR = function (d) {
        var $$ = this, config = $$.config;
        return $$.isStepType(d) ? 0 : (isFunction(config.point_r) ? config.point_r(d) : config.point_r);
    };
    c3_chart_internal_fn.pointExpandedR = function (d) {
        var $$ = this, config = $$.config;
        return config.point_focus_expand_enabled ? (config.point_focus_expand_r ? config.point_focus_expand_r : $$.pointR(d) * 1.75) : $$.pointR(d);
    };
    c3_chart_internal_fn.pointSelectR = function (d) {
        var $$ = this, config = $$.config;
        return isFunction(config.point_select_r) ? config.point_select_r(d) : ((config.point_select_r) ? config.point_select_r : $$.pointR(d) * 4);
    };
    c3_chart_internal_fn.isWithinCircle = function (that, r) {
        var d3 = this.d3,
            mouse = d3.mouse(that), d3_this = d3.select(that),
            cx = +d3_this.attr("cx"), cy = +d3_this.attr("cy");
        return Math.sqrt(Math.pow(cx - mouse[0], 2) + Math.pow(cy - mouse[1], 2)) < r;
    };
    c3_chart_internal_fn.isWithinStep = function (that, y) {
        return Math.abs(y - this.d3.mouse(that)[1]) < 30;
    };

    c3_chart_internal_fn.initBar = function () {
        var $$ = this;
        $$.main.select('.' + CLASS.chart).append("g")
            .attr("class", CLASS.chartBars);
    };
    c3_chart_internal_fn.updateTargetsForBar = function (targets) {
        var $$ = this, config = $$.config,
            mainBarUpdate, mainBarEnter,
            classChartBar = $$.classChartBar.bind($$),
            classBars = $$.classBars.bind($$),
            classFocus = $$.classFocus.bind($$);
        mainBarUpdate = $$.main.select('.' + CLASS.chartBars).selectAll('.' + CLASS.chartBar)
            .data(targets)
            .attr('class', function (d) { return classChartBar(d) + classFocus(d); });
        mainBarEnter = mainBarUpdate.enter().append('g')
            .attr('class', classChartBar)
            .style('opacity', 0)
            .style("pointer-events", "none");
        // Bars for each data
        mainBarEnter.append('g')
            .attr("class", classBars)
            .style("cursor", function (d) { return config.data_selection_isselectable(d) ? "pointer" : null; });

    };
    c3_chart_internal_fn.updateBar = function (durationForExit) {
        var $$ = this,
            barData = $$.barData.bind($$),
            classBar = $$.classBar.bind($$),
            initialOpacity = $$.initialOpacity.bind($$),
            color = function (d) { return $$.color(d.id); };
        $$.mainBar = $$.main.selectAll('.' + CLASS.bars).selectAll('.' + CLASS.bar)
            .data(barData);
        $$.mainBar.enter().append('path')
            .attr("class", classBar)
            .style("stroke", color)
            .style("fill", color);
        $$.mainBar
            .style("opacity", initialOpacity);
        $$.mainBar.exit().transition().duration(durationForExit)
            .style('opacity', 0)
            .remove();
    };
    c3_chart_internal_fn.redrawBar = function (drawBar, withTransition) {
        return [
            (withTransition ? this.mainBar.transition(Math.random().toString()) : this.mainBar)
                .attr('d', drawBar)
                .style("fill", this.color)
                .style("opacity", 1)
        ];
    };
    c3_chart_internal_fn.getBarW = function (axis, barTargetsNum) {
        var $$ = this, config = $$.config,
            w = typeof config.bar_width === 'number' ? config.bar_width : barTargetsNum ? (axis.tickInterval() * config.bar_width_ratio) / barTargetsNum : 0;
        return config.bar_width_max && w > config.bar_width_max ? config.bar_width_max : w;
    };
    c3_chart_internal_fn.getBars = function (i, id) {
        var $$ = this;
        return (id ? $$.main.selectAll('.' + CLASS.bars + $$.getTargetSelectorSuffix(id)) : $$.main).selectAll('.' + CLASS.bar + (isValue(i) ? '-' + i : ''));
    };
    c3_chart_internal_fn.expandBars = function (i, id, reset) {
        var $$ = this;
        if (reset) { $$.unexpandBars(); }
        $$.getBars(i, id).classed(CLASS.EXPANDED, true);
    };
    c3_chart_internal_fn.unexpandBars = function (i) {
        var $$ = this;
        $$.getBars(i).classed(CLASS.EXPANDED, false);
    };
    c3_chart_internal_fn.generateDrawBar = function (barIndices, isSub) {
        var $$ = this, config = $$.config,
            getPoints = $$.generateGetBarPoints(barIndices, isSub);
        return function (d, i) {
            // 4 points that make a bar
            var points = getPoints(d, i);

            // switch points if axis is rotated, not applicable for sub chart
            var indexX = config.axis_rotated ? 1 : 0;
            var indexY = config.axis_rotated ? 0 : 1;

            var path = 'M ' + points[0][indexX] + ',' + points[0][indexY] + ' ' +
                    'L' + points[1][indexX] + ',' + points[1][indexY] + ' ' +
                    'L' + points[2][indexX] + ',' + points[2][indexY] + ' ' +
                    'L' + points[3][indexX] + ',' + points[3][indexY] + ' ' +
                    'z';

            return path;
        };
    };
    c3_chart_internal_fn.generateGetBarPoints = function (barIndices, isSub) {
        var $$ = this,
            axis = isSub ? $$.subXAxis : $$.xAxis,
            barTargetsNum = barIndices.__max__ + 1,
            barW = $$.getBarW(axis, barTargetsNum),
            barX = $$.getShapeX(barW, barTargetsNum, barIndices, !!isSub),
            barY = $$.getShapeY(!!isSub),
            barOffset = $$.getShapeOffset($$.isBarType, barIndices, !!isSub),
            yScale = isSub ? $$.getSubYScale : $$.getYScale;
        return function (d, i) {
            var y0 = yScale.call($$, d.id)(0),
                offset = barOffset(d, i) || y0, // offset is for stacked bar chart
                posX = barX(d), posY = barY(d);
            // fix posY not to overflow opposite quadrant
            if ($$.config.axis_rotated) {
                if ((0 < d.value && posY < y0) || (d.value < 0 && y0 < posY)) { posY = y0; }
            }
            // 4 points that make a bar
            return [
                [posX, offset],
                [posX, posY - (y0 - offset)],
                [posX + barW, posY - (y0 - offset)],
                [posX + barW, offset]
            ];
        };
    };
    c3_chart_internal_fn.isWithinBar = function (that) {
        var mouse = this.d3.mouse(that), box = that.getBoundingClientRect(),
            seg0 = that.pathSegList.getItem(0), seg1 = that.pathSegList.getItem(1),
            x = Math.min(seg0.x, seg1.x), y = Math.min(seg0.y, seg1.y),
            w = box.width, h = box.height, offset = 2,
            sx = x - offset, ex = x + w + offset, sy = y + h + offset, ey = y - offset;
        return sx < mouse[0] && mouse[0] < ex && ey < mouse[1] && mouse[1] < sy;
    };

    c3_chart_internal_fn.initText = function () {
        var $$ = this;
        $$.main.select('.' + CLASS.chart).append("g")
            .attr("class", CLASS.chartTexts);
        $$.mainText = $$.d3.selectAll([]);
    };
    c3_chart_internal_fn.updateTargetsForText = function (targets) {
        var $$ = this, mainTextUpdate, mainTextEnter,
            classChartText = $$.classChartText.bind($$),
            classTexts = $$.classTexts.bind($$),
            classFocus = $$.classFocus.bind($$);
        mainTextUpdate = $$.main.select('.' + CLASS.chartTexts).selectAll('.' + CLASS.chartText)
            .data(targets)
            .attr('class', function (d) { return classChartText(d) + classFocus(d); });
        mainTextEnter = mainTextUpdate.enter().append('g')
            .attr('class', classChartText)
            .style('opacity', 0)
            .style("pointer-events", "none");
        mainTextEnter.append('g')
            .attr('class', classTexts);
    };
    c3_chart_internal_fn.updateText = function (durationForExit) {
        var $$ = this, config = $$.config,
            barOrLineData = $$.barOrLineData.bind($$),
            classText = $$.classText.bind($$);
        $$.mainText = $$.main.selectAll('.' + CLASS.texts).selectAll('.' + CLASS.text)
            .data(barOrLineData);
        $$.mainText.enter().append('text')
            .attr("class", classText)
            .attr('text-anchor', function (d) { return config.axis_rotated ? (d.value < 0 ? 'end' : 'start') : 'middle'; })
            .style("stroke", 'none')
            .style("fill", function (d) { return $$.color(d); })
            .style("fill-opacity", 0);
        $$.mainText
            .text(function (d, i, j) { return $$.dataLabelFormat(d.id)(d.value, d.id, i, j); });
        $$.mainText.exit()
            .transition().duration(durationForExit)
            .style('fill-opacity', 0)
            .remove();
    };
    c3_chart_internal_fn.redrawText = function (xForText, yForText, forFlow, withTransition) {
        return [
            (withTransition ? this.mainText.transition() : this.mainText)
                .attr('x', xForText)
                .attr('y', yForText)
                .style("fill", this.color)
                .style("fill-opacity", forFlow ? 0 : this.opacityForText.bind(this))
        ];
    };
    c3_chart_internal_fn.getTextRect = function (text, cls, element) {
        var dummy = this.d3.select('body').append('div').classed('c3', true),
            svg = dummy.append("svg").style('visibility', 'hidden').style('position', 'fixed').style('top', 0).style('left', 0),
            font = this.d3.select(element).style('font'),
            rect;
        svg.selectAll('.dummy')
            .data([text])
          .enter().append('text')
            .classed(cls ? cls : "", true)
            .style('font', font)
            .text(text)
          .each(function () { rect = this.getBoundingClientRect(); });
        dummy.remove();
        return rect;
    };
    c3_chart_internal_fn.generateXYForText = function (areaIndices, barIndices, lineIndices, forX) {
        var $$ = this,
            getAreaPoints = $$.generateGetAreaPoints(areaIndices, false),
            getBarPoints = $$.generateGetBarPoints(barIndices, false),
            getLinePoints = $$.generateGetLinePoints(lineIndices, false),
            getter = forX ? $$.getXForText : $$.getYForText;
        return function (d, i) {
            var getPoints = $$.isAreaType(d) ? getAreaPoints : $$.isBarType(d) ? getBarPoints : getLinePoints;
            return getter.call($$, getPoints(d, i), d, this);
        };
    };
    c3_chart_internal_fn.getXForText = function (points, d, textElement) {
        var $$ = this,
            box = textElement.getBoundingClientRect(), xPos, padding;
        if ($$.config.axis_rotated) {
            padding = $$.isBarType(d) ? 4 : 6;
            xPos = points[2][1] + padding * (d.value < 0 ? -1 : 1);
        } else {
            xPos = $$.hasType('bar') ? (points[2][0] + points[0][0]) / 2 : points[0][0];
        }
        // show labels regardless of the domain if value is null
        if (d.value === null) {
            if (xPos > $$.width) {
                xPos = $$.width - box.width;
            } else if (xPos < 0) {
                xPos = 4;
            }
        }
        return xPos;
    };
    c3_chart_internal_fn.getYForText = function (points, d, textElement) {
        var $$ = this,
            box = textElement.getBoundingClientRect(),
            yPos;
        if ($$.config.axis_rotated) {
            yPos = (points[0][0] + points[2][0] + box.height * 0.6) / 2;
        } else {
            yPos = points[2][1];
            if (d.value < 0  || (d.value === 0 && !$$.hasPositiveValue)) {
                yPos += box.height;
                if ($$.isBarType(d) && $$.isSafari()) {
                    yPos -= 3;
                }
                else if (!$$.isBarType(d) && $$.isChrome()) {
                    yPos += 3;
                }
            } else {
                yPos += $$.isBarType(d) ? -3 : -6;
            }
        }
        // show labels regardless of the domain if value is null
        if (d.value === null && !$$.config.axis_rotated) {
            if (yPos < box.height) {
                yPos = box.height;
            } else if (yPos > this.height) {
                yPos = this.height - 4;
            }
        }
        return yPos;
    };

    c3_chart_internal_fn.setTargetType = function (targetIds, type) {
        var $$ = this, config = $$.config;
        $$.mapToTargetIds(targetIds).forEach(function (id) {
            $$.withoutFadeIn[id] = (type === config.data_types[id]);
            config.data_types[id] = type;
        });
        if (!targetIds) {
            config.data_type = type;
        }
    };
    c3_chart_internal_fn.hasType = function (type, targets) {
        var $$ = this, types = $$.config.data_types, has = false;
        targets = targets || $$.data.targets;
        if (targets && targets.length) {
            targets.forEach(function (target) {
                var t = types[target.id];
                if ((t && t.indexOf(type) >= 0) || (!t && type === 'line')) {
                    has = true;
                }
            });
        } else if (Object.keys(types).length) {
            Object.keys(types).forEach(function (id) {
                if (types[id] === type) { has = true; }
            });
        } else {
            has = $$.config.data_type === type;
        }
        return has;
    };
    c3_chart_internal_fn.hasArcType = function (targets) {
        return this.hasType('pie', targets) || this.hasType('donut', targets) || this.hasType('gauge', targets);
    };
    c3_chart_internal_fn.isLineType = function (d) {
        var config = this.config, id = isString(d) ? d : d.id;
        return !config.data_types[id] || ['line', 'spline', 'area', 'area-spline', 'step', 'area-step'].indexOf(config.data_types[id]) >= 0;
    };
    c3_chart_internal_fn.isStepType = function (d) {
        var id = isString(d) ? d : d.id;
        return ['step', 'area-step'].indexOf(this.config.data_types[id]) >= 0;
    };
    c3_chart_internal_fn.isSplineType = function (d) {
        var id = isString(d) ? d : d.id;
        return ['spline', 'area-spline'].indexOf(this.config.data_types[id]) >= 0;
    };
    c3_chart_internal_fn.isAreaType = function (d) {
        var id = isString(d) ? d : d.id;
        return ['area', 'area-spline', 'area-step'].indexOf(this.config.data_types[id]) >= 0;
    };
    c3_chart_internal_fn.isBarType = function (d) {
        var id = isString(d) ? d : d.id;
        return this.config.data_types[id] === 'bar';
    };
    c3_chart_internal_fn.isScatterType = function (d) {
        var id = isString(d) ? d : d.id;
        return this.config.data_types[id] === 'scatter';
    };
    c3_chart_internal_fn.isPieType = function (d) {
        var id = isString(d) ? d : d.id;
        return this.config.data_types[id] === 'pie';
    };
    c3_chart_internal_fn.isGaugeType = function (d) {
        var id = isString(d) ? d : d.id;
        return this.config.data_types[id] === 'gauge';
    };
    c3_chart_internal_fn.isDonutType = function (d) {
        var id = isString(d) ? d : d.id;
        return this.config.data_types[id] === 'donut';
    };
    c3_chart_internal_fn.isArcType = function (d) {
        return this.isPieType(d) || this.isDonutType(d) || this.isGaugeType(d);
    };
    c3_chart_internal_fn.lineData = function (d) {
        return this.isLineType(d) ? [d] : [];
    };
    c3_chart_internal_fn.arcData = function (d) {
        return this.isArcType(d.data) ? [d] : [];
    };
    /* not used
     function scatterData(d) {
     return isScatterType(d) ? d.values : [];
     }
     */
    c3_chart_internal_fn.barData = function (d) {
        return this.isBarType(d) ? d.values : [];
    };
    c3_chart_internal_fn.lineOrScatterData = function (d) {
        return this.isLineType(d) || this.isScatterType(d) ? d.values : [];
    };
    c3_chart_internal_fn.barOrLineData = function (d) {
        return this.isBarType(d) || this.isLineType(d) ? d.values : [];
    };
    c3_chart_internal_fn.isInterpolationType = function (type) {
        return ['linear', 'linear-closed', 'basis', 'basis-open', 'basis-closed', 'bundle', 'cardinal', 'cardinal-open', 'cardinal-closed', 'monotone'].indexOf(type) >= 0;
    };

    c3_chart_internal_fn.initGrid = function () {
        var $$ = this, config = $$.config, d3 = $$.d3;
        $$.grid = $$.main.append('g')
            .attr("clip-path", $$.clipPathForGrid)
            .attr('class', CLASS.grid);
        if (config.grid_x_show) {
            $$.grid.append("g").attr("class", CLASS.xgrids);
        }
        if (config.grid_y_show) {
            $$.grid.append('g').attr('class', CLASS.ygrids);
        }
        if (config.grid_focus_show) {
            $$.grid.append('g')
                .attr("class", CLASS.xgridFocus)
                .append('line')
                .attr('class', CLASS.xgridFocus);
        }
        $$.xgrid = d3.selectAll([]);
        if (!config.grid_lines_front) { $$.initGridLines(); }
    };
    c3_chart_internal_fn.initGridLines = function () {
        var $$ = this, d3 = $$.d3;
        $$.gridLines = $$.main.append('g')
            .attr("clip-path", $$.clipPathForGrid)
            .attr('class', CLASS.grid + ' ' + CLASS.gridLines);
        $$.gridLines.append('g').attr("class", CLASS.xgridLines);
        $$.gridLines.append('g').attr('class', CLASS.ygridLines);
        $$.xgridLines = d3.selectAll([]);
    };
    c3_chart_internal_fn.updateXGrid = function (withoutUpdate) {
        var $$ = this, config = $$.config, d3 = $$.d3,
            xgridData = $$.generateGridData(config.grid_x_type, $$.x),
            tickOffset = $$.isCategorized() ? $$.xAxis.tickOffset() : 0;

        $$.xgridAttr = config.axis_rotated ? {
            'x1': 0,
            'x2': $$.width,
            'y1': function (d) { return $$.x(d) - tickOffset; },
            'y2': function (d) { return $$.x(d) - tickOffset; }
        } : {
            'x1': function (d) { return $$.x(d) + tickOffset; },
            'x2': function (d) { return $$.x(d) + tickOffset; },
            'y1': 0,
            'y2': $$.height
        };

        $$.xgrid = $$.main.select('.' + CLASS.xgrids).selectAll('.' + CLASS.xgrid)
            .data(xgridData);
        $$.xgrid.enter().append('line').attr("class", CLASS.xgrid);
        if (!withoutUpdate) {
            $$.xgrid.attr($$.xgridAttr)
                .style("opacity", function () { return +d3.select(this).attr(config.axis_rotated ? 'y1' : 'x1') === (config.axis_rotated ? $$.height : 0) ? 0 : 1; });
        }
        $$.xgrid.exit().remove();
    };

    c3_chart_internal_fn.updateYGrid = function () {
        var $$ = this, config = $$.config,
            gridValues = $$.yAxis.tickValues() || $$.y.ticks(config.grid_y_ticks);
        $$.ygrid = $$.main.select('.' + CLASS.ygrids).selectAll('.' + CLASS.ygrid)
            .data(gridValues);
        $$.ygrid.enter().append('line')
            .attr('class', CLASS.ygrid);
        $$.ygrid.attr("x1", config.axis_rotated ? $$.y : 0)
            .attr("x2", config.axis_rotated ? $$.y : $$.width)
            .attr("y1", config.axis_rotated ? 0 : $$.y)
            .attr("y2", config.axis_rotated ? $$.height : $$.y);
        $$.ygrid.exit().remove();
        $$.smoothLines($$.ygrid, 'grid');
    };

    c3_chart_internal_fn.gridTextAnchor = function (d) {
        return d.position ? d.position : "end";
    };
    c3_chart_internal_fn.gridTextDx = function (d) {
        return d.position === 'start' ? 4 : d.position === 'middle' ? 0 : -4;
    };
    c3_chart_internal_fn.xGridTextX = function (d) {
        return d.position === 'start' ? -this.height : d.position === 'middle' ? -this.height / 2 : 0;
    };
    c3_chart_internal_fn.yGridTextX = function (d) {
        return d.position === 'start' ? 0 : d.position === 'middle' ? this.width / 2 : this.width;
    };
    c3_chart_internal_fn.updateGrid = function (duration) {
        var $$ = this, main = $$.main, config = $$.config,
            xgridLine, ygridLine, yv;

        // hide if arc type
        $$.grid.style('visibility', $$.hasArcType() ? 'hidden' : 'visible');

        main.select('line.' + CLASS.xgridFocus).style("visibility", "hidden");
        if (config.grid_x_show) {
            $$.updateXGrid();
        }
        $$.xgridLines = main.select('.' + CLASS.xgridLines).selectAll('.' + CLASS.xgridLine)
            .data(config.grid_x_lines);
        // enter
        xgridLine = $$.xgridLines.enter().append('g')
            .attr("class", function (d) { return CLASS.xgridLine + (d['class'] ? ' ' + d['class'] : ''); });
        xgridLine.append('line')
            .style("opacity", 0);
        xgridLine.append('text')
            .attr("text-anchor", $$.gridTextAnchor)
            .attr("transform", config.axis_rotated ? "" : "rotate(-90)")
            .attr('dx', $$.gridTextDx)
            .attr('dy', -5)
            .style("opacity", 0);
        // udpate
        // done in d3.transition() of the end of this function
        // exit
        $$.xgridLines.exit().transition().duration(duration)
            .style("opacity", 0)
            .remove();

        // Y-Grid
        if (config.grid_y_show) {
            $$.updateYGrid();
        }
        $$.ygridLines = main.select('.' + CLASS.ygridLines).selectAll('.' + CLASS.ygridLine)
            .data(config.grid_y_lines);
        // enter
        ygridLine = $$.ygridLines.enter().append('g')
            .attr("class", function (d) { return CLASS.ygridLine + (d['class'] ? ' ' + d['class'] : ''); });
        ygridLine.append('line')
            .style("opacity", 0);
        ygridLine.append('text')
            .attr("text-anchor", $$.gridTextAnchor)
            .attr("transform", config.axis_rotated ? "rotate(-90)" : "")
            .attr('dx', $$.gridTextDx)
            .attr('dy', -5)
            .style("opacity", 0);
        // update
        yv = $$.yv.bind($$);
        $$.ygridLines.select('line')
          .transition().duration(duration)
            .attr("x1", config.axis_rotated ? yv : 0)
            .attr("x2", config.axis_rotated ? yv : $$.width)
            .attr("y1", config.axis_rotated ? 0 : yv)
            .attr("y2", config.axis_rotated ? $$.height : yv)
            .style("opacity", 1);
        $$.ygridLines.select('text')
          .transition().duration(duration)
            .attr("x", config.axis_rotated ? $$.xGridTextX.bind($$) : $$.yGridTextX.bind($$))
            .attr("y", yv)
            .text(function (d) { return d.text; })
            .style("opacity", 1);
        // exit
        $$.ygridLines.exit().transition().duration(duration)
            .style("opacity", 0)
            .remove();
    };
    c3_chart_internal_fn.redrawGrid = function (withTransition) {
        var $$ = this, config = $$.config, xv = $$.xv.bind($$),
            lines = $$.xgridLines.select('line'),
            texts = $$.xgridLines.select('text');
        return [
            (withTransition ? lines.transition() : lines)
                .attr("x1", config.axis_rotated ? 0 : xv)
                .attr("x2", config.axis_rotated ? $$.width : xv)
                .attr("y1", config.axis_rotated ? xv : 0)
                .attr("y2", config.axis_rotated ? xv : $$.height)
                .style("opacity", 1),
            (withTransition ? texts.transition() : texts)
                .attr("x", config.axis_rotated ? $$.yGridTextX.bind($$) : $$.xGridTextX.bind($$))
                .attr("y", xv)
                .text(function (d) { return d.text; })
                .style("opacity", 1)
        ];
    };
    c3_chart_internal_fn.showXGridFocus = function (selectedData) {
        var $$ = this, config = $$.config,
            dataToShow = selectedData.filter(function (d) { return d && isValue(d.value); }),
            focusEl = $$.main.selectAll('line.' + CLASS.xgridFocus),
            xx = $$.xx.bind($$);
        if (! config.tooltip_show) { return; }
        // Hide when scatter plot exists
        if ($$.hasType('scatter') || $$.hasArcType()) { return; }
        focusEl
            .style("visibility", "visible")
            .data([dataToShow[0]])
            .attr(config.axis_rotated ? 'y1' : 'x1', xx)
            .attr(config.axis_rotated ? 'y2' : 'x2', xx);
        $$.smoothLines(focusEl, 'grid');
    };
    c3_chart_internal_fn.hideXGridFocus = function () {
        this.main.select('line.' + CLASS.xgridFocus).style("visibility", "hidden");
    };
    c3_chart_internal_fn.updateXgridFocus = function () {
        var $$ = this, config = $$.config;
        $$.main.select('line.' + CLASS.xgridFocus)
            .attr("x1", config.axis_rotated ? 0 : -10)
            .attr("x2", config.axis_rotated ? $$.width : -10)
            .attr("y1", config.axis_rotated ? -10 : 0)
            .attr("y2", config.axis_rotated ? -10 : $$.height);
    };
    c3_chart_internal_fn.generateGridData = function (type, scale) {
        var $$ = this,
            gridData = [], xDomain, firstYear, lastYear, i,
            tickNum = $$.main.select("." + CLASS.axisX).selectAll('.tick').size();
        if (type === 'year') {
            xDomain = $$.getXDomain();
            firstYear = xDomain[0].getFullYear();
            lastYear = xDomain[1].getFullYear();
            for (i = firstYear; i <= lastYear; i++) {
                gridData.push(new Date(i + '-01-01 00:00:00'));
            }
        } else {
            gridData = scale.ticks(10);
            if (gridData.length > tickNum) { // use only int
                gridData = gridData.filter(function (d) { return ("" + d).indexOf('.') < 0; });
            }
        }
        return gridData;
    };
    c3_chart_internal_fn.getGridFilterToRemove = function (params) {
        return params ? function (line) {
            var found = false;
            [].concat(params).forEach(function (param) {
                if ((('value' in param && line.value === param.value) || ('class' in param && line['class'] === param['class']))) {
                    found = true;
                }
            });
            return found;
        } : function () { return true; };
    };
    c3_chart_internal_fn.removeGridLines = function (params, forX) {
        var $$ = this, config = $$.config,
            toRemove = $$.getGridFilterToRemove(params),
            toShow = function (line) { return !toRemove(line); },
            classLines = forX ? CLASS.xgridLines : CLASS.ygridLines,
            classLine = forX ? CLASS.xgridLine : CLASS.ygridLine;
        $$.main.select('.' + classLines).selectAll('.' + classLine).filter(toRemove)
            .transition().duration(config.transition_duration)
            .style('opacity', 0).remove();
        if (forX) {
            config.grid_x_lines = config.grid_x_lines.filter(toShow);
        } else {
            config.grid_y_lines = config.grid_y_lines.filter(toShow);
        }
    };

    c3_chart_internal_fn.initTooltip = function () {
        var $$ = this, config = $$.config, i;
        $$.tooltip = $$.selectChart
            .style("position", "relative")
          .append("div")
            .attr('class', CLASS.tooltipContainer)
            .style("position", "absolute")
            .style("pointer-events", "none")
            .style("display", "none");
        // Show tooltip if needed
        if (config.tooltip_init_show) {
            if ($$.isTimeSeries() && isString(config.tooltip_init_x)) {
                config.tooltip_init_x = $$.parseDate(config.tooltip_init_x);
                for (i = 0; i < $$.data.targets[0].values.length; i++) {
                    if (($$.data.targets[0].values[i].x - config.tooltip_init_x) === 0) { break; }
                }
                config.tooltip_init_x = i;
            }
            $$.tooltip.html(config.tooltip_contents.call($$, $$.data.targets.map(function (d) {
                return $$.addName(d.values[config.tooltip_init_x]);
            }), $$.axis.getXAxisTickFormat(), $$.getYFormat($$.hasArcType()), $$.color));
            $$.tooltip.style("top", config.tooltip_init_position.top)
                .style("left", config.tooltip_init_position.left)
                .style("display", "block");
        }
    };
    c3_chart_internal_fn.getTooltipContent = function (d, defaultTitleFormat, defaultValueFormat, color) {
        var $$ = this, config = $$.config,
            titleFormat = config.tooltip_format_title || defaultTitleFormat,
            nameFormat = config.tooltip_format_name || function (name) { return name; },
            valueFormat = config.tooltip_format_value || defaultValueFormat,
            text, i, title, value, name, bgcolor,
            orderAsc = $$.isOrderAsc();

        if (config.data_groups.length === 0) {
            d.sort(function(a, b){
                var v1 = a ? a.value : null, v2 = b ? b.value : null;
                return orderAsc ? v1 - v2 : v2 - v1;
            });
        } else {
            var ids = $$.orderTargets($$.data.targets).map(function (i) {
                return i.id;
            });
            d.sort(function(a, b) {
                var v1 = a ? a.value : null, v2 = b ? b.value : null;
                if (v1 > 0 && v2 > 0) {
                    v1 = a ? ids.indexOf(a.id) : null;
                    v2 = b ? ids.indexOf(b.id) : null;
                }
                return orderAsc ? v1 - v2 : v2 - v1;
            });
        }

        for (i = 0; i < d.length; i++) {
            if (! (d[i] && (d[i].value || d[i].value === 0))) { continue; }

            if (! text) {
                title = sanitise(titleFormat ? titleFormat(d[i].x) : d[i].x);
                text = "<table class='" + $$.CLASS.tooltip + "'>" + (title || title === 0 ? "<tr><th colspan='2'>" + title + "</th></tr>" : "");
            }

            value = sanitise(valueFormat(d[i].value, d[i].ratio, d[i].id, d[i].index, d));
            if (value !== undefined) {
                // Skip elements when their name is set to null
                if (d[i].name === null) { continue; }
                name = sanitise(nameFormat(d[i].name, d[i].ratio, d[i].id, d[i].index));
                bgcolor = $$.levelColor ? $$.levelColor(d[i].value) : color(d[i].id);

                text += "<tr class='" + $$.CLASS.tooltipName + "-" + $$.getTargetSelectorSuffix(d[i].id) + "'>";
                text += "<td class='name'><span style='background-color:" + bgcolor + "'></span>" + name + "</td>";
                text += "<td class='value'>" + value + "</td>";
                text += "</tr>";
            }
        }
        return text + "</table>";
    };
    c3_chart_internal_fn.tooltipPosition = function (dataToShow, tWidth, tHeight, element) {
        var $$ = this, config = $$.config, d3 = $$.d3;
        var svgLeft, tooltipLeft, tooltipRight, tooltipTop, chartRight;
        var forArc = $$.hasArcType(),
            mouse = d3.mouse(element);
      // Determin tooltip position
        if (forArc) {
            tooltipLeft = (($$.width - ($$.isLegendRight ? $$.getLegendWidth() : 0)) / 2) + mouse[0];
            tooltipTop = ($$.height / 2) + mouse[1] + 20;
        } else {
            svgLeft = $$.getSvgLeft(true);
            if (config.axis_rotated) {
                tooltipLeft = svgLeft + mouse[0] + 100;
                tooltipRight = tooltipLeft + tWidth;
                chartRight = $$.currentWidth - $$.getCurrentPaddingRight();
                tooltipTop = $$.x(dataToShow[0].x) + 20;
            } else {
                tooltipLeft = svgLeft + $$.getCurrentPaddingLeft(true) + $$.x(dataToShow[0].x) + 20;
                tooltipRight = tooltipLeft + tWidth;
                chartRight = svgLeft + $$.currentWidth - $$.getCurrentPaddingRight();
                tooltipTop = mouse[1] + 15;
            }

            if (tooltipRight > chartRight) {
                // 20 is needed for Firefox to keep tooltip width
                tooltipLeft -= tooltipRight - chartRight + 20;
            }
            if (tooltipTop + tHeight > $$.currentHeight) {
                tooltipTop -= tHeight + 30;
            }
        }
        if (tooltipTop < 0) {
            tooltipTop = 0;
        }
        return {top: tooltipTop, left: tooltipLeft};
    };
    c3_chart_internal_fn.showTooltip = function (selectedData, element) {
        var $$ = this, config = $$.config;
        var tWidth, tHeight, position;
        var forArc = $$.hasArcType(),
            dataToShow = selectedData.filter(function (d) { return d && isValue(d.value); }),
            positionFunction = config.tooltip_position || c3_chart_internal_fn.tooltipPosition;
        if (dataToShow.length === 0 || !config.tooltip_show) {
            return;
        }
        $$.tooltip.html(config.tooltip_contents.call($$, selectedData, $$.axis.getXAxisTickFormat(), $$.getYFormat(forArc), $$.color)).style("display", "block");

        // Get tooltip dimensions
        tWidth = $$.tooltip.property('offsetWidth');
        tHeight = $$.tooltip.property('offsetHeight');

        position = positionFunction.call(this, dataToShow, tWidth, tHeight, element);
        // Set tooltip
        $$.tooltip
            .style("top", position.top + "px")
            .style("left", position.left + 'px');
    };
    c3_chart_internal_fn.hideTooltip = function () {
        this.tooltip.style("display", "none");
    };

    c3_chart_internal_fn.initLegend = function () {
        var $$ = this;
        $$.legendItemTextBox = {};
        $$.legendHasRendered = false;
        $$.legend = $$.svg.append("g").attr("transform", $$.getTranslate('legend'));
        if (!$$.config.legend_show) {
            $$.legend.style('visibility', 'hidden');
            $$.hiddenLegendIds = $$.mapToIds($$.data.targets);
            return;
        }
        // MEMO: call here to update legend box and tranlate for all
        // MEMO: translate will be upated by this, so transform not needed in updateLegend()
        $$.updateLegendWithDefaults();
    };
    c3_chart_internal_fn.updateLegendWithDefaults = function () {
        var $$ = this;
        $$.updateLegend($$.mapToIds($$.data.targets), {withTransform: false, withTransitionForTransform: false, withTransition: false});
    };
    c3_chart_internal_fn.updateSizeForLegend = function (legendHeight, legendWidth) {
        var $$ = this, config = $$.config, insetLegendPosition = {
            top: $$.isLegendTop ? $$.getCurrentPaddingTop() + config.legend_inset_y + 5.5 : $$.currentHeight - legendHeight - $$.getCurrentPaddingBottom() - config.legend_inset_y,
            left: $$.isLegendLeft ? $$.getCurrentPaddingLeft() + config.legend_inset_x + 0.5 : $$.currentWidth - legendWidth - $$.getCurrentPaddingRight() - config.legend_inset_x + 0.5
        };

        $$.margin3 = {
            top: $$.isLegendRight ? 0 : $$.isLegendInset ? insetLegendPosition.top : $$.currentHeight - legendHeight,
            right: NaN,
            bottom: 0,
            left: $$.isLegendRight ? $$.currentWidth - legendWidth : $$.isLegendInset ? insetLegendPosition.left : 0
        };
    };
    c3_chart_internal_fn.transformLegend = function (withTransition) {
        var $$ = this;
        (withTransition ? $$.legend.transition() : $$.legend).attr("transform", $$.getTranslate('legend'));
    };
    c3_chart_internal_fn.updateLegendStep = function (step) {
        this.legendStep = step;
    };
    c3_chart_internal_fn.updateLegendItemWidth = function (w) {
        this.legendItemWidth = w;
    };
    c3_chart_internal_fn.updateLegendItemHeight = function (h) {
        this.legendItemHeight = h;
    };
    c3_chart_internal_fn.getLegendWidth = function () {
        var $$ = this;
        return $$.config.legend_show ? $$.isLegendRight || $$.isLegendInset ? $$.legendItemWidth * ($$.legendStep + 1) : $$.currentWidth : 0;
    };
    c3_chart_internal_fn.getLegendHeight = function () {
        var $$ = this, h = 0;
        if ($$.config.legend_show) {
            if ($$.isLegendRight) {
                h = $$.currentHeight;
            } else {
                h = Math.max(20, $$.legendItemHeight) * ($$.legendStep + 1);
            }
        }
        return h;
    };
    c3_chart_internal_fn.opacityForLegend = function (legendItem) {
        return legendItem.classed(CLASS.legendItemHidden) ? null : 1;
    };
    c3_chart_internal_fn.opacityForUnfocusedLegend = function (legendItem) {
        return legendItem.classed(CLASS.legendItemHidden) ? null : 0.3;
    };
    c3_chart_internal_fn.toggleFocusLegend = function (targetIds, focus) {
        var $$ = this;
        targetIds = $$.mapToTargetIds(targetIds);
        $$.legend.selectAll('.' + CLASS.legendItem)
            .filter(function (id) { return targetIds.indexOf(id) >= 0; })
            .classed(CLASS.legendItemFocused, focus)
          .transition().duration(100)
            .style('opacity', function () {
                var opacity = focus ? $$.opacityForLegend : $$.opacityForUnfocusedLegend;
                return opacity.call($$, $$.d3.select(this));
            });
    };
    c3_chart_internal_fn.revertLegend = function () {
        var $$ = this, d3 = $$.d3;
        $$.legend.selectAll('.' + CLASS.legendItem)
            .classed(CLASS.legendItemFocused, false)
            .transition().duration(100)
            .style('opacity', function () { return $$.opacityForLegend(d3.select(this)); });
    };
    c3_chart_internal_fn.showLegend = function (targetIds) {
        var $$ = this, config = $$.config;
        if (!config.legend_show) {
            config.legend_show = true;
            $$.legend.style('visibility', 'visible');
            if (!$$.legendHasRendered) {
                $$.updateLegendWithDefaults();
            }
        }
        $$.removeHiddenLegendIds(targetIds);
        $$.legend.selectAll($$.selectorLegends(targetIds))
            .style('visibility', 'visible')
            .transition()
            .style('opacity', function () { return $$.opacityForLegend($$.d3.select(this)); });
    };
    c3_chart_internal_fn.hideLegend = function (targetIds) {
        var $$ = this, config = $$.config;
        if (config.legend_show && isEmpty(targetIds)) {
            config.legend_show = false;
            $$.legend.style('visibility', 'hidden');
        }
        $$.addHiddenLegendIds(targetIds);
        $$.legend.selectAll($$.selectorLegends(targetIds))
            .style('opacity', 0)
            .style('visibility', 'hidden');
    };
    c3_chart_internal_fn.clearLegendItemTextBoxCache = function () {
        this.legendItemTextBox = {};
    };
    c3_chart_internal_fn.updateLegend = function (targetIds, options, transitions) {
        var $$ = this, config = $$.config;
        var xForLegend, xForLegendText, xForLegendRect, yForLegend, yForLegendText, yForLegendRect, x1ForLegendTile, x2ForLegendTile, yForLegendTile;
        var paddingTop = 4, paddingRight = 10, maxWidth = 0, maxHeight = 0, posMin = 10, tileWidth = config.legend_item_tile_width + 5;
        var l, totalLength = 0, offsets = {}, widths = {}, heights = {}, margins = [0], steps = {}, step = 0;
        var withTransition, withTransitionForTransform;
        var texts, rects, tiles, background;

        // Skip elements when their name is set to null
        targetIds = targetIds.filter(function(id) {
            return !isDefined(config.data_names[id]) || config.data_names[id] !== null;
        });

        options = options || {};
        withTransition = getOption(options, "withTransition", true);
        withTransitionForTransform = getOption(options, "withTransitionForTransform", true);

        function getTextBox(textElement, id) {
            if (!$$.legendItemTextBox[id]) {
                $$.legendItemTextBox[id] = $$.getTextRect(textElement.textContent, CLASS.legendItem, textElement);
            }
            return $$.legendItemTextBox[id];
        }

        function updatePositions(textElement, id, index) {
            var reset = index === 0, isLast = index === targetIds.length - 1,
                box = getTextBox(textElement, id),
                itemWidth = box.width + tileWidth + (isLast && !($$.isLegendRight || $$.isLegendInset) ? 0 : paddingRight) + config.legend_padding,
                itemHeight = box.height + paddingTop,
                itemLength = $$.isLegendRight || $$.isLegendInset ? itemHeight : itemWidth,
                areaLength = $$.isLegendRight || $$.isLegendInset ? $$.getLegendHeight() : $$.getLegendWidth(),
                margin, maxLength;

            // MEMO: care about condifion of step, totalLength
            function updateValues(id, withoutStep) {
                if (!withoutStep) {
                    margin = (areaLength - totalLength - itemLength) / 2;
                    if (margin < posMin) {
                        margin = (areaLength - itemLength) / 2;
                        totalLength = 0;
                        step++;
                    }
                }
                steps[id] = step;
                margins[step] = $$.isLegendInset ? 10 : margin;
                offsets[id] = totalLength;
                totalLength += itemLength;
            }

            if (reset) {
                totalLength = 0;
                step = 0;
                maxWidth = 0;
                maxHeight = 0;
            }

            if (config.legend_show && !$$.isLegendToShow(id)) {
                widths[id] = heights[id] = steps[id] = offsets[id] = 0;
                return;
            }

            widths[id] = itemWidth;
            heights[id] = itemHeight;

            if (!maxWidth || itemWidth >= maxWidth) { maxWidth = itemWidth; }
            if (!maxHeight || itemHeight >= maxHeight) { maxHeight = itemHeight; }
            maxLength = $$.isLegendRight || $$.isLegendInset ? maxHeight : maxWidth;

            if (config.legend_equally) {
                Object.keys(widths).forEach(function (id) { widths[id] = maxWidth; });
                Object.keys(heights).forEach(function (id) { heights[id] = maxHeight; });
                margin = (areaLength - maxLength * targetIds.length) / 2;
                if (margin < posMin) {
                    totalLength = 0;
                    step = 0;
                    targetIds.forEach(function (id) { updateValues(id); });
                }
                else {
                    updateValues(id, true);
                }
            } else {
                updateValues(id);
            }
        }

        if ($$.isLegendInset) {
            step = config.legend_inset_step ? config.legend_inset_step : targetIds.length;
            $$.updateLegendStep(step);
        }

        if ($$.isLegendRight) {
            xForLegend = function (id) { return maxWidth * steps[id]; };
            yForLegend = function (id) { return margins[steps[id]] + offsets[id]; };
        } else if ($$.isLegendInset) {
            xForLegend = function (id) { return maxWidth * steps[id] + 10; };
            yForLegend = function (id) { return margins[steps[id]] + offsets[id]; };
        } else {
            xForLegend = function (id) { return margins[steps[id]] + offsets[id]; };
            yForLegend = function (id) { return maxHeight * steps[id]; };
        }
        xForLegendText = function (id, i) { return xForLegend(id, i) + 4 + config.legend_item_tile_width; };
        yForLegendText = function (id, i) { return yForLegend(id, i) + 9; };
        xForLegendRect = function (id, i) { return xForLegend(id, i); };
        yForLegendRect = function (id, i) { return yForLegend(id, i) - 5; };
        x1ForLegendTile = function (id, i) { return xForLegend(id, i) - 2; };
        x2ForLegendTile = function (id, i) { return xForLegend(id, i) - 2 + config.legend_item_tile_width; };
        yForLegendTile = function (id, i) { return yForLegend(id, i) + 4; };

        // Define g for legend area
        l = $$.legend.selectAll('.' + CLASS.legendItem)
            .data(targetIds)
            .enter().append('g')
            .attr('class', function (id) { return $$.generateClass(CLASS.legendItem, id); })
            .style('visibility', function (id) { return $$.isLegendToShow(id) ? 'visible' : 'hidden'; })
            .style('cursor', 'pointer')
            .on('click', function (id) {
                if (config.legend_item_onclick) {
                    config.legend_item_onclick.call($$, id);
                } else {
                    if ($$.d3.event.altKey) {
                        $$.api.hide();
                        $$.api.show(id);
                    } else {
                        $$.api.toggle(id);
                        $$.isTargetToShow(id) ? $$.api.focus(id) : $$.api.revert();
                    }
                }
            })
            .on('mouseover', function (id) {
                if (config.legend_item_onmouseover) {
                    config.legend_item_onmouseover.call($$, id);
                }
                else {
                    $$.d3.select(this).classed(CLASS.legendItemFocused, true);
                    if (!$$.transiting && $$.isTargetToShow(id)) {
                        $$.api.focus(id);
                    }
                }
            })
            .on('mouseout', function (id) {
                if (config.legend_item_onmouseout) {
                    config.legend_item_onmouseout.call($$, id);
                }
                else {
                    $$.d3.select(this).classed(CLASS.legendItemFocused, false);
                    $$.api.revert();
                }
            });
        l.append('text')
            .text(function (id) { return isDefined(config.data_names[id]) ? config.data_names[id] : id; })
            .each(function (id, i) { updatePositions(this, id, i); })
            .style("pointer-events", "none")
            .attr('x', $$.isLegendRight || $$.isLegendInset ? xForLegendText : -200)
            .attr('y', $$.isLegendRight || $$.isLegendInset ? -200 : yForLegendText);
        l.append('rect')
            .attr("class", CLASS.legendItemEvent)
            .style('fill-opacity', 0)
            .attr('x', $$.isLegendRight || $$.isLegendInset ? xForLegendRect : -200)
            .attr('y', $$.isLegendRight || $$.isLegendInset ? -200 : yForLegendRect);
        l.append('line')
            .attr('class', CLASS.legendItemTile)
            .style('stroke', $$.color)
            .style("pointer-events", "none")
            .attr('x1', $$.isLegendRight || $$.isLegendInset ? x1ForLegendTile : -200)
            .attr('y1', $$.isLegendRight || $$.isLegendInset ? -200 : yForLegendTile)
            .attr('x2', $$.isLegendRight || $$.isLegendInset ? x2ForLegendTile : -200)
            .attr('y2', $$.isLegendRight || $$.isLegendInset ? -200 : yForLegendTile)
            .attr('stroke-width', config.legend_item_tile_height);

        // Set background for inset legend
        background = $$.legend.select('.' + CLASS.legendBackground + ' rect');
        if ($$.isLegendInset && maxWidth > 0 && background.size() === 0) {
            background = $$.legend.insert('g', '.' + CLASS.legendItem)
                .attr("class", CLASS.legendBackground)
                .append('rect');
        }

        texts = $$.legend.selectAll('text')
            .data(targetIds)
            .text(function (id) { return isDefined(config.data_names[id]) ? config.data_names[id] : id; }) // MEMO: needed for update
            .each(function (id, i) { updatePositions(this, id, i); });
        (withTransition ? texts.transition() : texts)
            .attr('x', xForLegendText)
            .attr('y', yForLegendText);

        rects = $$.legend.selectAll('rect.' + CLASS.legendItemEvent)
            .data(targetIds);
        (withTransition ? rects.transition() : rects)
            .attr('width', function (id) { return widths[id]; })
            .attr('height', function (id) { return heights[id]; })
            .attr('x', xForLegendRect)
            .attr('y', yForLegendRect);

        tiles = $$.legend.selectAll('line.' + CLASS.legendItemTile)
                .data(targetIds);
            (withTransition ? tiles.transition() : tiles)
                .style('stroke', $$.color)
                .attr('x1', x1ForLegendTile)
                .attr('y1', yForLegendTile)
                .attr('x2', x2ForLegendTile)
                .attr('y2', yForLegendTile);

        if (background) {
            (withTransition ? background.transition() : background)
                .attr('height', $$.getLegendHeight() - 12)
                .attr('width', maxWidth * (step + 1) + 10);
        }

        // toggle legend state
        $$.legend.selectAll('.' + CLASS.legendItem)
            .classed(CLASS.legendItemHidden, function (id) { return !$$.isTargetToShow(id); });

        // Update all to reflect change of legend
        $$.updateLegendItemWidth(maxWidth);
        $$.updateLegendItemHeight(maxHeight);
        $$.updateLegendStep(step);
        // Update size and scale
        $$.updateSizes();
        $$.updateScales();
        $$.updateSvgSize();
        // Update g positions
        $$.transformAll(withTransitionForTransform, transitions);
        $$.legendHasRendered = true;
    };

    c3_chart_internal_fn.initTitle = function () {
        var $$ = this;
        $$.title = $$.svg.append("text")
              .text($$.config.title_text)
              .attr("class", $$.CLASS.title);
    };
    c3_chart_internal_fn.redrawTitle = function () {
        var $$ = this;
        $$.title
              .attr("x", $$.xForTitle.bind($$))
              .attr("y", $$.yForTitle.bind($$));
    };
    c3_chart_internal_fn.xForTitle = function () {
        var $$ = this, config = $$.config, position = config.title_position || 'left', x;
        if (position.indexOf('right') >= 0) {
            x = $$.currentWidth - $$.getTextRect($$.title.node().textContent, $$.CLASS.title, $$.title.node()).width - config.title_padding.right;
        } else if (position.indexOf('center') >= 0) {
            x = ($$.currentWidth - $$.getTextRect($$.title.node().textContent, $$.CLASS.title, $$.title.node()).width) / 2;
        } else { // left
            x = config.title_padding.left;
        }
        return x;
    };
    c3_chart_internal_fn.yForTitle = function () {
        var $$ = this;
        return $$.config.title_padding.top + $$.getTextRect($$.title.node().textContent, $$.CLASS.title, $$.title.node()).height;
    };
    c3_chart_internal_fn.getTitlePadding = function() {
        var $$ = this;
        return $$.yForTitle() + $$.config.title_padding.bottom;
    };

    function Axis(owner) {
        API.call(this, owner);
    }

    inherit(API, Axis);

    Axis.prototype.init = function init() {

        var $$ = this.owner, config = $$.config, main = $$.main;
        $$.axes.x = main.append("g")
            .attr("class", CLASS.axis + ' ' + CLASS.axisX)
            .attr("clip-path", $$.clipPathForXAxis)
            .attr("transform", $$.getTranslate('x'))
            .style("visibility", config.axis_x_show ? 'visible' : 'hidden');
        $$.axes.x.append("text")
            .attr("class", CLASS.axisXLabel)
            .attr("transform", config.axis_rotated ? "rotate(-90)" : "")
            .style("text-anchor", this.textAnchorForXAxisLabel.bind(this));
        $$.axes.y = main.append("g")
            .attr("class", CLASS.axis + ' ' + CLASS.axisY)
            .attr("clip-path", config.axis_y_inner ? "" : $$.clipPathForYAxis)
            .attr("transform", $$.getTranslate('y'))
            .style("visibility", config.axis_y_show ? 'visible' : 'hidden');
        $$.axes.y.append("text")
            .attr("class", CLASS.axisYLabel)
            .attr("transform", config.axis_rotated ? "" : "rotate(-90)")
            .style("text-anchor", this.textAnchorForYAxisLabel.bind(this));

        $$.axes.y2 = main.append("g")
            .attr("class", CLASS.axis + ' ' + CLASS.axisY2)
            // clip-path?
            .attr("transform", $$.getTranslate('y2'))
            .style("visibility", config.axis_y2_show ? 'visible' : 'hidden');
        $$.axes.y2.append("text")
            .attr("class", CLASS.axisY2Label)
            .attr("transform", config.axis_rotated ? "" : "rotate(-90)")
            .style("text-anchor", this.textAnchorForY2AxisLabel.bind(this));
    };
    Axis.prototype.getXAxis = function getXAxis(scale, orient, tickFormat, tickValues, withOuterTick, withoutTransition, withoutRotateTickText) {
        var $$ = this.owner, config = $$.config,
            axisParams = {
                isCategory: $$.isCategorized(),
                withOuterTick: withOuterTick,
                tickMultiline: config.axis_x_tick_multiline,
                tickMultilineOffset: config.axis_x_tick_offset,
                tickWidth: config.axis_x_tick_width,
                tickTextRotate: withoutRotateTickText ? 0 : config.axis_x_tick_rotate,
                withoutTransition: withoutTransition,
            },
            axis = c3_axis($$.d3, axisParams).scale(scale).orient(orient);

        if ($$.isTimeSeries() && tickValues && typeof tickValues !== "function") {
            tickValues = tickValues.map(function (v) { return $$.parseDate(v); });
        }

        // Set tick
        axis.tickFormat(tickFormat).tickValues(tickValues);
        if ($$.isCategorized()) {
            axis.tickCentered(config.axis_x_tick_centered);
            if (isEmpty(config.axis_x_tick_culling)) {
                config.axis_x_tick_culling = false;
            }
        }

        return axis;
    };
    Axis.prototype.updateXAxisTickValues = function updateXAxisTickValues(targets, axis) {
        var $$ = this.owner, config = $$.config, tickValues;
        if (config.axis_x_tick_fit || config.axis_x_tick_count) {
            tickValues = this.generateTickValues($$.mapTargetsToUniqueXs(targets), config.axis_x_tick_count, $$.isTimeSeries());
        }
        if (axis) {
            axis.tickValues(tickValues);
        } else {
            $$.xAxis.tickValues(tickValues);
            $$.subXAxis.tickValues(tickValues);
        }
        return tickValues;
    };
    Axis.prototype.getYAxis = function getYAxis(scale, orient, tickFormat, tickValues, withOuterTick, withoutTransition, withoutRotateTickText) {
        var $$ = this.owner, config = $$.config,
            axisParams = {
                withOuterTick: withOuterTick,
                withoutTransition: withoutTransition,
                tickTextRotate: withoutRotateTickText ? 0 : config.axis_y_tick_rotate
            },
            axis = c3_axis($$.d3, axisParams).scale(scale).orient(orient).tickFormat(tickFormat);
        if ($$.isTimeSeriesY()) {
            axis.ticks($$.d3.time[config.axis_y_tick_time_value], config.axis_y_tick_time_interval);
        } else {
            axis.tickValues(tickValues);
        }
        return axis;
    };
    Axis.prototype.getId = function getId(id) {
        var config = this.owner.config;
        return id in config.data_axes ? config.data_axes[id] : 'y';
    };
    Axis.prototype.getXAxisTickFormat = function getXAxisTickFormat() {
        var $$ = this.owner, config = $$.config,
            format = $$.isTimeSeries() ? $$.defaultAxisTimeFormat : $$.isCategorized() ? $$.categoryName : function (v) { return v < 0 ? v.toFixed(0) : v; };
        if (config.axis_x_tick_format) {
            if (isFunction(config.axis_x_tick_format)) {
                format = config.axis_x_tick_format;
            } else if ($$.isTimeSeries()) {
                format = function (date) {
                    return date ? $$.axisTimeFormat(config.axis_x_tick_format)(date) : "";
                };
            }
        }
        return isFunction(format) ? function (v) { return format.call($$, v); } : format;
    };
    Axis.prototype.getTickValues = function getTickValues(tickValues, axis) {
        return tickValues ? tickValues : axis ? axis.tickValues() : undefined;
    };
    Axis.prototype.getXAxisTickValues = function getXAxisTickValues() {
        return this.getTickValues(this.owner.config.axis_x_tick_values, this.owner.xAxis);
    };
    Axis.prototype.getYAxisTickValues = function getYAxisTickValues() {
        return this.getTickValues(this.owner.config.axis_y_tick_values, this.owner.yAxis);
    };
    Axis.prototype.getY2AxisTickValues = function getY2AxisTickValues() {
        return this.getTickValues(this.owner.config.axis_y2_tick_values, this.owner.y2Axis);
    };
    Axis.prototype.getLabelOptionByAxisId = function getLabelOptionByAxisId(axisId) {
        var $$ = this.owner, config = $$.config, option;
        if (axisId === 'y') {
            option = config.axis_y_label;
        } else if (axisId === 'y2') {
            option = config.axis_y2_label;
        } else if (axisId === 'x') {
            option = config.axis_x_label;
        }
        return option;
    };
    Axis.prototype.getLabelText = function getLabelText(axisId) {
        var option = this.getLabelOptionByAxisId(axisId);
        return isString(option) ? option : option ? option.text : null;
    };
    Axis.prototype.setLabelText = function setLabelText(axisId, text) {
        var $$ = this.owner, config = $$.config,
            option = this.getLabelOptionByAxisId(axisId);
        if (isString(option)) {
            if (axisId === 'y') {
                config.axis_y_label = text;
            } else if (axisId === 'y2') {
                config.axis_y2_label = text;
            } else if (axisId === 'x') {
                config.axis_x_label = text;
            }
        } else if (option) {
            option.text = text;
        }
    };
    Axis.prototype.getLabelPosition = function getLabelPosition(axisId, defaultPosition) {
        var option = this.getLabelOptionByAxisId(axisId),
            position = (option && typeof option === 'object' && option.position) ? option.position : defaultPosition;
        return {
            isInner: position.indexOf('inner') >= 0,
            isOuter: position.indexOf('outer') >= 0,
            isLeft: position.indexOf('left') >= 0,
            isCenter: position.indexOf('center') >= 0,
            isRight: position.indexOf('right') >= 0,
            isTop: position.indexOf('top') >= 0,
            isMiddle: position.indexOf('middle') >= 0,
            isBottom: position.indexOf('bottom') >= 0
        };
    };
    Axis.prototype.getXAxisLabelPosition = function getXAxisLabelPosition() {
        return this.getLabelPosition('x', this.owner.config.axis_rotated ? 'inner-top' : 'inner-right');
    };
    Axis.prototype.getYAxisLabelPosition = function getYAxisLabelPosition() {
        return this.getLabelPosition('y', this.owner.config.axis_rotated ? 'inner-right' : 'inner-top');
    };
    Axis.prototype.getY2AxisLabelPosition = function getY2AxisLabelPosition() {
        return this.getLabelPosition('y2', this.owner.config.axis_rotated ? 'inner-right' : 'inner-top');
    };
    Axis.prototype.getLabelPositionById = function getLabelPositionById(id) {
        return id === 'y2' ? this.getY2AxisLabelPosition() : id === 'y' ? this.getYAxisLabelPosition() : this.getXAxisLabelPosition();
    };
    Axis.prototype.textForXAxisLabel = function textForXAxisLabel() {
        return this.getLabelText('x');
    };
    Axis.prototype.textForYAxisLabel = function textForYAxisLabel() {
        return this.getLabelText('y');
    };
    Axis.prototype.textForY2AxisLabel = function textForY2AxisLabel() {
        return this.getLabelText('y2');
    };
    Axis.prototype.xForAxisLabel = function xForAxisLabel(forHorizontal, position) {
        var $$ = this.owner;
        if (forHorizontal) {
            return position.isLeft ? 0 : position.isCenter ? $$.width / 2 : $$.width;
        } else {
            return position.isBottom ? -$$.height : position.isMiddle ? -$$.height / 2 : 0;
        }
    };
    Axis.prototype.dxForAxisLabel = function dxForAxisLabel(forHorizontal, position) {
        if (forHorizontal) {
            return position.isLeft ? "0.5em" : position.isRight ? "-0.5em" : "0";
        } else {
            return position.isTop ? "-0.5em" : position.isBottom ? "0.5em" : "0";
        }
    };
    Axis.prototype.textAnchorForAxisLabel = function textAnchorForAxisLabel(forHorizontal, position) {
        if (forHorizontal) {
            return position.isLeft ? 'start' : position.isCenter ? 'middle' : 'end';
        } else {
            return position.isBottom ? 'start' : position.isMiddle ? 'middle' : 'end';
        }
    };
    Axis.prototype.xForXAxisLabel = function xForXAxisLabel() {
        return this.xForAxisLabel(!this.owner.config.axis_rotated, this.getXAxisLabelPosition());
    };
    Axis.prototype.xForYAxisLabel = function xForYAxisLabel() {
        return this.xForAxisLabel(this.owner.config.axis_rotated, this.getYAxisLabelPosition());
    };
    Axis.prototype.xForY2AxisLabel = function xForY2AxisLabel() {
        return this.xForAxisLabel(this.owner.config.axis_rotated, this.getY2AxisLabelPosition());
    };
    Axis.prototype.dxForXAxisLabel = function dxForXAxisLabel() {
        return this.dxForAxisLabel(!this.owner.config.axis_rotated, this.getXAxisLabelPosition());
    };
    Axis.prototype.dxForYAxisLabel = function dxForYAxisLabel() {
        return this.dxForAxisLabel(this.owner.config.axis_rotated, this.getYAxisLabelPosition());
    };
    Axis.prototype.dxForY2AxisLabel = function dxForY2AxisLabel() {
        return this.dxForAxisLabel(this.owner.config.axis_rotated, this.getY2AxisLabelPosition());
    };
    Axis.prototype.dyForXAxisLabel = function dyForXAxisLabel() {
        var $$ = this.owner, config = $$.config,
            position = this.getXAxisLabelPosition();
        if (config.axis_rotated) {
            return position.isInner ? "1.2em" : -25 - this.getMaxTickWidth('x');
        } else {
            return position.isInner ? "-0.5em" : config.axis_x_height ? config.axis_x_height - 10 : "3em";
        }
    };
    Axis.prototype.dyForYAxisLabel = function dyForYAxisLabel() {
        var $$ = this.owner,
            position = this.getYAxisLabelPosition();
        if ($$.config.axis_rotated) {
            return position.isInner ? "-0.5em" : "3em";
        } else {
            return position.isInner ? "1.2em" : -10 - ($$.config.axis_y_inner ? 0 : (this.getMaxTickWidth('y') + 10));
        }
    };
    Axis.prototype.dyForY2AxisLabel = function dyForY2AxisLabel() {
        var $$ = this.owner,
            position = this.getY2AxisLabelPosition();
        if ($$.config.axis_rotated) {
            return position.isInner ? "1.2em" : "-2.2em";
        } else {
            return position.isInner ? "-0.5em" : 15 + ($$.config.axis_y2_inner ? 0 : (this.getMaxTickWidth('y2') + 15));
        }
    };
    Axis.prototype.textAnchorForXAxisLabel = function textAnchorForXAxisLabel() {
        var $$ = this.owner;
        return this.textAnchorForAxisLabel(!$$.config.axis_rotated, this.getXAxisLabelPosition());
    };
    Axis.prototype.textAnchorForYAxisLabel = function textAnchorForYAxisLabel() {
        var $$ = this.owner;
        return this.textAnchorForAxisLabel($$.config.axis_rotated, this.getYAxisLabelPosition());
    };
    Axis.prototype.textAnchorForY2AxisLabel = function textAnchorForY2AxisLabel() {
        var $$ = this.owner;
        return this.textAnchorForAxisLabel($$.config.axis_rotated, this.getY2AxisLabelPosition());
    };
    Axis.prototype.getMaxTickWidth = function getMaxTickWidth(id, withoutRecompute) {
        var $$ = this.owner, config = $$.config,
            maxWidth = 0, targetsToShow, scale, axis, dummy, svg;
        if (withoutRecompute && $$.currentMaxTickWidths[id]) {
            return $$.currentMaxTickWidths[id];
        }
        if ($$.svg) {
            targetsToShow = $$.filterTargetsToShow($$.data.targets);
            if (id === 'y') {
                scale = $$.y.copy().domain($$.getYDomain(targetsToShow, 'y'));
                axis = this.getYAxis(scale, $$.yOrient, config.axis_y_tick_format, $$.yAxisTickValues, false, true, true);
            } else if (id === 'y2') {
                scale = $$.y2.copy().domain($$.getYDomain(targetsToShow, 'y2'));
                axis = this.getYAxis(scale, $$.y2Orient, config.axis_y2_tick_format, $$.y2AxisTickValues, false, true, true);
            } else {
                scale = $$.x.copy().domain($$.getXDomain(targetsToShow));
                axis = this.getXAxis(scale, $$.xOrient, $$.xAxisTickFormat, $$.xAxisTickValues, false, true, true);
                this.updateXAxisTickValues(targetsToShow, axis);
            }
            dummy = $$.d3.select('body').append('div').classed('c3', true);
            svg = dummy.append("svg").style('visibility', 'hidden').style('position', 'fixed').style('top', 0).style('left', 0),
            svg.append('g').call(axis).each(function () {
                $$.d3.select(this).selectAll('text').each(function () {
                    var box = this.getBoundingClientRect();
                    if (maxWidth < box.width) { maxWidth = box.width; }
                });
                dummy.remove();
            });
        }
        $$.currentMaxTickWidths[id] = maxWidth <= 0 ? $$.currentMaxTickWidths[id] : maxWidth;
        return $$.currentMaxTickWidths[id];
    };

    Axis.prototype.updateLabels = function updateLabels(withTransition) {
        var $$ = this.owner;
        var axisXLabel = $$.main.select('.' + CLASS.axisX + ' .' + CLASS.axisXLabel),
            axisYLabel = $$.main.select('.' + CLASS.axisY + ' .' + CLASS.axisYLabel),
            axisY2Label = $$.main.select('.' + CLASS.axisY2 + ' .' + CLASS.axisY2Label);
        (withTransition ? axisXLabel.transition() : axisXLabel)
            .attr("x", this.xForXAxisLabel.bind(this))
            .attr("dx", this.dxForXAxisLabel.bind(this))
            .attr("dy", this.dyForXAxisLabel.bind(this))
            .text(this.textForXAxisLabel.bind(this));
        (withTransition ? axisYLabel.transition() : axisYLabel)
            .attr("x", this.xForYAxisLabel.bind(this))
            .attr("dx", this.dxForYAxisLabel.bind(this))
            .attr("dy", this.dyForYAxisLabel.bind(this))
            .text(this.textForYAxisLabel.bind(this));
        (withTransition ? axisY2Label.transition() : axisY2Label)
            .attr("x", this.xForY2AxisLabel.bind(this))
            .attr("dx", this.dxForY2AxisLabel.bind(this))
            .attr("dy", this.dyForY2AxisLabel.bind(this))
            .text(this.textForY2AxisLabel.bind(this));
    };
    Axis.prototype.getPadding = function getPadding(padding, key, defaultValue, domainLength) {
        var p = typeof padding === 'number' ? padding : padding[key];
        if (!isValue(p)) {
            return defaultValue;
        }
        if (padding.unit === 'ratio') {
            return padding[key] * domainLength;
        }
        // assume padding is pixels if unit is not specified
        return this.convertPixelsToAxisPadding(p, domainLength);
    };
    Axis.prototype.convertPixelsToAxisPadding = function convertPixelsToAxisPadding(pixels, domainLength) {
        var $$ = this.owner,
            length = $$.config.axis_rotated ? $$.width : $$.height;
        return domainLength * (pixels / length);
    };
    Axis.prototype.generateTickValues = function generateTickValues(values, tickCount, forTimeSeries) {
        var tickValues = values, targetCount, start, end, count, interval, i, tickValue;
        if (tickCount) {
            targetCount = isFunction(tickCount) ? tickCount() : tickCount;
            // compute ticks according to tickCount
            if (targetCount === 1) {
                tickValues = [values[0]];
            } else if (targetCount === 2) {
                tickValues = [values[0], values[values.length - 1]];
            } else if (targetCount > 2) {
                count = targetCount - 2;
                start = values[0];
                end = values[values.length - 1];
                interval = (end - start) / (count + 1);
                // re-construct unique values
                tickValues = [start];
                for (i = 0; i < count; i++) {
                    tickValue = +start + interval * (i + 1);
                    tickValues.push(forTimeSeries ? new Date(tickValue) : tickValue);
                }
                tickValues.push(end);
            }
        }
        if (!forTimeSeries) { tickValues = tickValues.sort(function (a, b) { return a - b; }); }
        return tickValues;
    };
    Axis.prototype.generateTransitions = function generateTransitions(duration) {
        var $$ = this.owner, axes = $$.axes;
        return {
            axisX: duration ? axes.x.transition().duration(duration) : axes.x,
            axisY: duration ? axes.y.transition().duration(duration) : axes.y,
            axisY2: duration ? axes.y2.transition().duration(duration) : axes.y2,
            axisSubX: duration ? axes.subx.transition().duration(duration) : axes.subx
        };
    };
    Axis.prototype.redraw = function redraw(transitions, isHidden) {
        var $$ = this.owner;
        $$.axes.x.style("opacity", isHidden ? 0 : 1);
        $$.axes.y.style("opacity", isHidden ? 0 : 1);
        $$.axes.y2.style("opacity", isHidden ? 0 : 1);
        $$.axes.subx.style("opacity", isHidden ? 0 : 1);
        transitions.axisX.call($$.xAxis);
        transitions.axisY.call($$.yAxis);
        transitions.axisY2.call($$.y2Axis);
        transitions.axisSubX.call($$.subXAxis);
    };

    c3_chart_internal_fn.getClipPath = function (id) {
        var isIE9 = window.navigator.appVersion.toLowerCase().indexOf("msie 9.") >= 0;
        return "url(" + (isIE9 ? "" : document.URL.split('#')[0]) + "#" + id + ")";
    };
    c3_chart_internal_fn.appendClip = function (parent, id) {
        return parent.append("clipPath").attr("id", id).append("rect");
    };
    c3_chart_internal_fn.getAxisClipX = function (forHorizontal) {
        // axis line width + padding for left
        var left = Math.max(30, this.margin.left);
        return forHorizontal ? -(1 + left) : -(left - 1);
    };
    c3_chart_internal_fn.getAxisClipY = function (forHorizontal) {
        return forHorizontal ? -20 : -this.margin.top;
    };
    c3_chart_internal_fn.getXAxisClipX = function () {
        var $$ = this;
        return $$.getAxisClipX(!$$.config.axis_rotated);
    };
    c3_chart_internal_fn.getXAxisClipY = function () {
        var $$ = this;
        return $$.getAxisClipY(!$$.config.axis_rotated);
    };
    c3_chart_internal_fn.getYAxisClipX = function () {
        var $$ = this;
        return $$.config.axis_y_inner ? -1 : $$.getAxisClipX($$.config.axis_rotated);
    };
    c3_chart_internal_fn.getYAxisClipY = function () {
        var $$ = this;
        return $$.getAxisClipY($$.config.axis_rotated);
    };
    c3_chart_internal_fn.getAxisClipWidth = function (forHorizontal) {
        var $$ = this,
            left = Math.max(30, $$.margin.left),
            right = Math.max(30, $$.margin.right);
        // width + axis line width + padding for left/right
        return forHorizontal ? $$.width + 2 + left + right : $$.margin.left + 20;
    };
    c3_chart_internal_fn.getAxisClipHeight = function (forHorizontal) {
        // less than 20 is not enough to show the axis label 'outer' without legend
        return (forHorizontal ? this.margin.bottom : (this.margin.top + this.height)) + 20;
    };
    c3_chart_internal_fn.getXAxisClipWidth = function () {
        var $$ = this;
        return $$.getAxisClipWidth(!$$.config.axis_rotated);
    };
    c3_chart_internal_fn.getXAxisClipHeight = function () {
        var $$ = this;
        return $$.getAxisClipHeight(!$$.config.axis_rotated);
    };
    c3_chart_internal_fn.getYAxisClipWidth = function () {
        var $$ = this;
        return $$.getAxisClipWidth($$.config.axis_rotated) + ($$.config.axis_y_inner ? 20 : 0);
    };
    c3_chart_internal_fn.getYAxisClipHeight = function () {
        var $$ = this;
        return $$.getAxisClipHeight($$.config.axis_rotated);
    };

    c3_chart_internal_fn.initPie = function () {
        var $$ = this, d3 = $$.d3, config = $$.config;
        $$.pie = d3.layout.pie().value(function (d) {
            return d.values.reduce(function (a, b) { return a + b.value; }, 0);
        });
        if (!config.data_order) {
            $$.pie.sort(null);
        }
    };

    c3_chart_internal_fn.updateRadius = function () {
        var $$ = this, config = $$.config,
            w = config.gauge_width || config.donut_width;
        $$.radiusExpanded = Math.min($$.arcWidth, $$.arcHeight) / 2;
        $$.radius = $$.radiusExpanded * 0.95;
        $$.innerRadiusRatio = w ? ($$.radius - w) / $$.radius : 0.6;
        $$.innerRadius = $$.hasType('donut') || $$.hasType('gauge') ? $$.radius * $$.innerRadiusRatio : 0;
    };

    c3_chart_internal_fn.updateArc = function () {
        var $$ = this;
        $$.svgArc = $$.getSvgArc();
        $$.svgArcExpanded = $$.getSvgArcExpanded();
        $$.svgArcExpandedSub = $$.getSvgArcExpanded(0.98);
    };

    c3_chart_internal_fn.updateAngle = function (d) {
        var $$ = this, config = $$.config,
            found = false, index = 0,
            gMin, gMax, gTic, gValue;

        if (!config) {
            return null;
        }

        $$.pie($$.filterTargetsToShow($$.data.targets)).forEach(function (t) {
            if (! found && t.data.id === d.data.id) {
                found = true;
                d = t;
                d.index = index;
            }
            index++;
        });
        if (isNaN(d.startAngle)) {
            d.startAngle = 0;
        }
        if (isNaN(d.endAngle)) {
            d.endAngle = d.startAngle;
        }
        if ($$.isGaugeType(d.data)) {
            gMin = config.gauge_min;
            gMax = config.gauge_max;
            gTic = (Math.PI * (config.gauge_fullCircle ? 2 : 1)) / (gMax - gMin);
            gValue = d.value < gMin ? 0 : d.value < gMax ? d.value - gMin : (gMax - gMin);
            d.startAngle = config.gauge_startingAngle;
            d.endAngle = d.startAngle + gTic * gValue;
        }
        return found ? d : null;
    };

    c3_chart_internal_fn.getSvgArc = function () {
        var $$ = this,
            arc = $$.d3.svg.arc().outerRadius($$.radius).innerRadius($$.innerRadius),
            newArc = function (d, withoutUpdate) {
                var updated;
                if (withoutUpdate) { return arc(d); } // for interpolate
                updated = $$.updateAngle(d);
                return updated ? arc(updated) : "M 0 0";
            };
        // TODO: extends all function
        newArc.centroid = arc.centroid;
        return newArc;
    };

    c3_chart_internal_fn.getSvgArcExpanded = function (rate) {
        var $$ = this,
            arc = $$.d3.svg.arc().outerRadius($$.radiusExpanded * (rate ? rate : 1)).innerRadius($$.innerRadius);
        return function (d) {
            var updated = $$.updateAngle(d);
            return updated ? arc(updated) : "M 0 0";
        };
    };

    c3_chart_internal_fn.getArc = function (d, withoutUpdate, force) {
        return force || this.isArcType(d.data) ? this.svgArc(d, withoutUpdate) : "M 0 0";
    };


    c3_chart_internal_fn.transformForArcLabel = function (d) {
        var $$ = this, config = $$.config,
            updated = $$.updateAngle(d), c, x, y, h, ratio, translate = "";
        if (updated && !$$.hasType('gauge')) {
            c = this.svgArc.centroid(updated);
            x = isNaN(c[0]) ? 0 : c[0];
            y = isNaN(c[1]) ? 0 : c[1];
            h = Math.sqrt(x * x + y * y);
            if ($$.hasType('donut') && config.donut_label_ratio) {
                ratio = isFunction(config.donut_label_ratio) ? config.donut_label_ratio(d, $$.radius, h) : config.donut_label_ratio;
            } else if ($$.hasType('pie') && config.pie_label_ratio) {
                ratio = isFunction(config.pie_label_ratio) ? config.pie_label_ratio(d, $$.radius, h) : config.pie_label_ratio;
            } else {
                ratio = $$.radius && h ? (36 / $$.radius > 0.375 ? 1.175 - 36 / $$.radius : 0.8) * $$.radius / h : 0;
            }
            translate = "translate(" + (x * ratio) +  ',' + (y * ratio) +  ")";
        }
        return translate;
    };

    c3_chart_internal_fn.getArcRatio = function (d) {
        var $$ = this,
            config = $$.config,
            whole = Math.PI * ($$.hasType('gauge') && !config.gauge_fullCircle ? 1 : 2);
        return d ? (d.endAngle - d.startAngle) / whole : null;
    };

    c3_chart_internal_fn.convertToArcData = function (d) {
        return this.addName({
            id: d.data.id,
            value: d.value,
            ratio: this.getArcRatio(d),
            index: d.index
        });
    };

    c3_chart_internal_fn.textForArcLabel = function (d) {
        var $$ = this,
            updated, value, ratio, id, format;
        if (! $$.shouldShowArcLabel()) { return ""; }
        updated = $$.updateAngle(d);
        value = updated ? updated.value : null;
        ratio = $$.getArcRatio(updated);
        id = d.data.id;
        if (! $$.hasType('gauge') && ! $$.meetsArcLabelThreshold(ratio)) { return ""; }
        format = $$.getArcLabelFormat();
        return format ? format(value, ratio, id) : $$.defaultArcValueFormat(value, ratio);
    };

    c3_chart_internal_fn.expandArc = function (targetIds) {
        var $$ = this, interval;

        // MEMO: avoid to cancel transition
        if ($$.transiting) {
            interval = window.setInterval(function () {
                if (!$$.transiting) {
                    window.clearInterval(interval);
                    if ($$.legend.selectAll('.c3-legend-item-focused').size() > 0) {
                        $$.expandArc(targetIds);
                    }
                }
            }, 10);
            return;
        }

        targetIds = $$.mapToTargetIds(targetIds);

        $$.svg.selectAll($$.selectorTargets(targetIds, '.' + CLASS.chartArc)).each(function (d) {
            if (! $$.shouldExpand(d.data.id)) { return; }
            $$.d3.select(this).selectAll('path')
                .transition().duration($$.expandDuration(d.data.id))
                .attr("d", $$.svgArcExpanded)
                .transition().duration($$.expandDuration(d.data.id) * 2)
                .attr("d", $$.svgArcExpandedSub)
                .each(function (d) {
                    if ($$.isDonutType(d.data)) {
                        // callback here
                    }
                });
        });
    };

    c3_chart_internal_fn.unexpandArc = function (targetIds) {
        var $$ = this;

        if ($$.transiting) { return; }

        targetIds = $$.mapToTargetIds(targetIds);

        $$.svg.selectAll($$.selectorTargets(targetIds, '.' + CLASS.chartArc)).selectAll('path')
            .transition().duration(function(d) {
                return $$.expandDuration(d.data.id);
            })
            .attr("d", $$.svgArc);
        $$.svg.selectAll('.' + CLASS.arc)
            .style("opacity", 1);
    };

    c3_chart_internal_fn.expandDuration = function (id) {
        var $$ = this, config = $$.config;

        if ($$.isDonutType(id)) {
            return config.donut_expand_duration;
        } else if ($$.isGaugeType(id)) {
            return config.gauge_expand_duration;
        } else if ($$.isPieType(id)) {
            return config.pie_expand_duration;
        } else {
            return 50;
        }

    };

    c3_chart_internal_fn.shouldExpand = function (id) {
        var $$ = this, config = $$.config;
        return ($$.isDonutType(id) && config.donut_expand) ||
               ($$.isGaugeType(id) && config.gauge_expand) ||
               ($$.isPieType(id) && config.pie_expand);
    };

    c3_chart_internal_fn.shouldShowArcLabel = function () {
        var $$ = this, config = $$.config, shouldShow = true;
        if ($$.hasType('donut')) {
            shouldShow = config.donut_label_show;
        } else if ($$.hasType('pie')) {
            shouldShow = config.pie_label_show;
        }
        // when gauge, always true
        return shouldShow;
    };

    c3_chart_internal_fn.meetsArcLabelThreshold = function (ratio) {
        var $$ = this, config = $$.config,
            threshold = $$.hasType('donut') ? config.donut_label_threshold : config.pie_label_threshold;
        return ratio >= threshold;
    };

    c3_chart_internal_fn.getArcLabelFormat = function () {
        var $$ = this, config = $$.config,
            format = config.pie_label_format;
        if ($$.hasType('gauge')) {
            format = config.gauge_label_format;
        } else if ($$.hasType('donut')) {
            format = config.donut_label_format;
        }
        return format;
    };

    c3_chart_internal_fn.getArcTitle = function () {
        var $$ = this;
        return $$.hasType('donut') ? $$.config.donut_title : "";
    };

    c3_chart_internal_fn.updateTargetsForArc = function (targets) {
        var $$ = this, main = $$.main,
            mainPieUpdate, mainPieEnter,
            classChartArc = $$.classChartArc.bind($$),
            classArcs = $$.classArcs.bind($$),
            classFocus = $$.classFocus.bind($$);
        mainPieUpdate = main.select('.' + CLASS.chartArcs).selectAll('.' + CLASS.chartArc)
            .data($$.pie(targets))
            .attr("class", function (d) { return classChartArc(d) + classFocus(d.data); });
        mainPieEnter = mainPieUpdate.enter().append("g")
            .attr("class", classChartArc);
        mainPieEnter.append('g')
            .attr('class', classArcs);
        mainPieEnter.append("text")
            .attr("dy", $$.hasType('gauge') ? "-.1em" : ".35em")
            .style("opacity", 0)
            .style("text-anchor", "middle")
            .style("pointer-events", "none");
        // MEMO: can not keep same color..., but not bad to update color in redraw
        //mainPieUpdate.exit().remove();
    };

    c3_chart_internal_fn.initArc = function () {
        var $$ = this;
        $$.arcs = $$.main.select('.' + CLASS.chart).append("g")
            .attr("class", CLASS.chartArcs)
            .attr("transform", $$.getTranslate('arc'));
        $$.arcs.append('text')
            .attr('class', CLASS.chartArcsTitle)
            .style("text-anchor", "middle")
            .text($$.getArcTitle());
    };

    c3_chart_internal_fn.redrawArc = function (duration, durationForExit, withTransform) {
        var $$ = this, d3 = $$.d3, config = $$.config, main = $$.main,
            mainArc;
        mainArc = main.selectAll('.' + CLASS.arcs).selectAll('.' + CLASS.arc)
            .data($$.arcData.bind($$));
        mainArc.enter().append('path')
            .attr("class", $$.classArc.bind($$))
            .style("fill", function (d) { return $$.color(d.data); })
            .style("cursor", function (d) { return config.interaction_enabled && config.data_selection_isselectable(d) ? "pointer" : null; })
            .style("opacity", 0)
            .each(function (d) {
                if ($$.isGaugeType(d.data)) {
                    d.startAngle = d.endAngle = config.gauge_startingAngle;
                }
                this._current = d;
            });
        mainArc
            .attr("transform", function (d) { return !$$.isGaugeType(d.data) && withTransform ? "scale(0)" : ""; })
            .style("opacity", function (d) { return d === this._current ? 0 : 1; })
            .on('mouseover', config.interaction_enabled ? function (d) {
                var updated, arcData;
                if ($$.transiting) { // skip while transiting
                    return;
                }
                updated = $$.updateAngle(d);
                if (updated) {
                    arcData = $$.convertToArcData(updated);
                    // transitions
                    $$.expandArc(updated.data.id);
                    $$.api.focus(updated.data.id);
                    $$.toggleFocusLegend(updated.data.id, true);
                    $$.config.data_onmouseover(arcData, this);
                }
            } : null)
            .on('mousemove', config.interaction_enabled ? function (d) {
                var updated = $$.updateAngle(d), arcData, selectedData;
                if (updated) {
                    arcData = $$.convertToArcData(updated),
                    selectedData = [arcData];
                    $$.showTooltip(selectedData, this);
                }
            } : null)
            .on('mouseout', config.interaction_enabled ? function (d) {
                var updated, arcData;
                if ($$.transiting) { // skip while transiting
                    return;
                }
                updated = $$.updateAngle(d);
                if (updated) {
                    arcData = $$.convertToArcData(updated);
                    // transitions
                    $$.unexpandArc(updated.data.id);
                    $$.api.revert();
                    $$.revertLegend();
                    $$.hideTooltip();
                    $$.config.data_onmouseout(arcData, this);
                }
            } : null)
            .on('click', config.interaction_enabled ? function (d, i) {
                var updated = $$.updateAngle(d), arcData;
                if (updated) {
                    arcData = $$.convertToArcData(updated);
                    if ($$.toggleShape) {
                        $$.toggleShape(this, arcData, i);
                    }
                    $$.config.data_onclick.call($$.api, arcData, this);
                }
            } : null)
            .each(function () { $$.transiting = true; })
            .transition().duration(duration)
            .attrTween("d", function (d) {
                var updated = $$.updateAngle(d), interpolate;
                if (! updated) {
                    return function () { return "M 0 0"; };
                }
                //                if (this._current === d) {
                //                    this._current = {
                //                        startAngle: Math.PI*2,
                //                        endAngle: Math.PI*2,
                //                    };
                //                }
                if (isNaN(this._current.startAngle)) {
                    this._current.startAngle = 0;
                }
                if (isNaN(this._current.endAngle)) {
                    this._current.endAngle = this._current.startAngle;
                }
                interpolate = d3.interpolate(this._current, updated);
                this._current = interpolate(0);
                return function (t) {
                    var interpolated = interpolate(t);
                    interpolated.data = d.data; // data.id will be updated by interporator
                    return $$.getArc(interpolated, true);
                };
            })
            .attr("transform", withTransform ? "scale(1)" : "")
            .style("fill", function (d) {
                return $$.levelColor ? $$.levelColor(d.data.values[0].value) : $$.color(d.data.id);
            }) // Where gauge reading color would receive customization.
            .style("opacity", 1)
            .call($$.endall, function () {
                $$.transiting = false;
            });
        mainArc.exit().transition().duration(durationForExit)
            .style('opacity', 0)
            .remove();
        main.selectAll('.' + CLASS.chartArc).select('text')
            .style("opacity", 0)
            .attr('class', function (d) { return $$.isGaugeType(d.data) ? CLASS.gaugeValue : ''; })
            .text($$.textForArcLabel.bind($$))
            .attr("transform", $$.transformForArcLabel.bind($$))
            .style('font-size', function (d) { return $$.isGaugeType(d.data) ? Math.round($$.radius / 5) + 'px' : ''; })
          .transition().duration(duration)
            .style("opacity", function (d) { return $$.isTargetToShow(d.data.id) && $$.isArcType(d.data) ? 1 : 0; });
        main.select('.' + CLASS.chartArcsTitle)
            .style("opacity", $$.hasType('donut') || $$.hasType('gauge') ? 1 : 0);

        if ($$.hasType('gauge')) {
            $$.arcs.select('.' + CLASS.chartArcsBackground)
                .attr("d", function () {
                    var d = {
                        data: [{value: config.gauge_max}],
                        startAngle: config.gauge_startingAngle,
                        endAngle: -1 * config.gauge_startingAngle
                    };
                    return $$.getArc(d, true, true);
                });
            $$.arcs.select('.' + CLASS.chartArcsGaugeUnit)
                .attr("dy", ".75em")
                .text(config.gauge_label_show ? config.gauge_units : '');
            $$.arcs.select('.' + CLASS.chartArcsGaugeMin)
                .attr("dx", -1 * ($$.innerRadius + (($$.radius - $$.innerRadius) / (config.gauge_fullCircle ? 1 : 2))) + "px")
                .attr("dy", "1.2em")
                .text(config.gauge_label_show ? config.gauge_min : '');
            $$.arcs.select('.' + CLASS.chartArcsGaugeMax)
                .attr("dx", $$.innerRadius + (($$.radius - $$.innerRadius) / (config.gauge_fullCircle ? 1 : 2)) + "px")
                .attr("dy", "1.2em")
                .text(config.gauge_label_show ? config.gauge_max : '');
        }
    };
    c3_chart_internal_fn.initGauge = function () {
        var arcs = this.arcs;
        if (this.hasType('gauge')) {
            arcs.append('path')
                .attr("class", CLASS.chartArcsBackground);
            arcs.append("text")
                .attr("class", CLASS.chartArcsGaugeUnit)
                .style("text-anchor", "middle")
                .style("pointer-events", "none");
            arcs.append("text")
                .attr("class", CLASS.chartArcsGaugeMin)
                .style("text-anchor", "middle")
                .style("pointer-events", "none");
            arcs.append("text")
                .attr("class", CLASS.chartArcsGaugeMax)
                .style("text-anchor", "middle")
                .style("pointer-events", "none");
        }
    };
    c3_chart_internal_fn.getGaugeLabelHeight = function () {
        return this.config.gauge_label_show ? 20 : 0;
    };

    c3_chart_internal_fn.initRegion = function () {
        var $$ = this;
        $$.region = $$.main.append('g')
            .attr("clip-path", $$.clipPath)
            .attr("class", CLASS.regions);
    };
    c3_chart_internal_fn.updateRegion = function (duration) {
        var $$ = this, config = $$.config;

        // hide if arc type
        $$.region.style('visibility', $$.hasArcType() ? 'hidden' : 'visible');

        $$.mainRegion = $$.main.select('.' + CLASS.regions).selectAll('.' + CLASS.region)
            .data(config.regions);
        $$.mainRegion.enter().append('g')
          .append('rect')
            .style("fill-opacity", 0);
        $$.mainRegion
            .attr('class', $$.classRegion.bind($$));
        $$.mainRegion.exit().transition().duration(duration)
            .style("opacity", 0)
            .remove();
    };
    c3_chart_internal_fn.redrawRegion = function (withTransition) {
        var $$ = this,
            regions = $$.mainRegion.selectAll('rect').each(function () {
                // data is binded to g and it's not transferred to rect (child node) automatically,
                // then data of each rect has to be updated manually.
                // TODO: there should be more efficient way to solve this?
                var parentData = $$.d3.select(this.parentNode).datum();
                $$.d3.select(this).datum(parentData);
            }),
            x = $$.regionX.bind($$),
            y = $$.regionY.bind($$),
            w = $$.regionWidth.bind($$),
            h = $$.regionHeight.bind($$);
        return [
            (withTransition ? regions.transition() : regions)
                .attr("x", x)
                .attr("y", y)
                .attr("width", w)
                .attr("height", h)
                .style("fill-opacity", function (d) { return isValue(d.opacity) ? d.opacity : 0.1; })
        ];
    };
    c3_chart_internal_fn.regionX = function (d) {
        var $$ = this, config = $$.config,
            xPos, yScale = d.axis === 'y' ? $$.y : $$.y2;
        if (d.axis === 'y' || d.axis === 'y2') {
            xPos = config.axis_rotated ? ('start' in d ? yScale(d.start) : 0) : 0;
        } else {
            xPos = config.axis_rotated ? 0 : ('start' in d ? $$.x($$.isTimeSeries() ? $$.parseDate(d.start) : d.start) : 0);
        }
        return xPos;
    };
    c3_chart_internal_fn.regionY = function (d) {
        var $$ = this, config = $$.config,
            yPos, yScale = d.axis === 'y' ? $$.y : $$.y2;
        if (d.axis === 'y' || d.axis === 'y2') {
            yPos = config.axis_rotated ? 0 : ('end' in d ? yScale(d.end) : 0);
        } else {
            yPos = config.axis_rotated ? ('start' in d ? $$.x($$.isTimeSeries() ? $$.parseDate(d.start) : d.start) : 0) : 0;
        }
        return yPos;
    };
    c3_chart_internal_fn.regionWidth = function (d) {
        var $$ = this, config = $$.config,
            start = $$.regionX(d), end, yScale = d.axis === 'y' ? $$.y : $$.y2;
        if (d.axis === 'y' || d.axis === 'y2') {
            end = config.axis_rotated ? ('end' in d ? yScale(d.end) : $$.width) : $$.width;
        } else {
            end = config.axis_rotated ? $$.width : ('end' in d ? $$.x($$.isTimeSeries() ? $$.parseDate(d.end) : d.end) : $$.width);
        }
        return end < start ? 0 : end - start;
    };
    c3_chart_internal_fn.regionHeight = function (d) {
        var $$ = this, config = $$.config,
            start = this.regionY(d), end, yScale = d.axis === 'y' ? $$.y : $$.y2;
        if (d.axis === 'y' || d.axis === 'y2') {
            end = config.axis_rotated ? $$.height : ('start' in d ? yScale(d.start) : $$.height);
        } else {
            end = config.axis_rotated ? ('end' in d ? $$.x($$.isTimeSeries() ? $$.parseDate(d.end) : d.end) : $$.height) : $$.height;
        }
        return end < start ? 0 : end - start;
    };
    c3_chart_internal_fn.isRegionOnX = function (d) {
        return !d.axis || d.axis === 'x';
    };

    c3_chart_internal_fn.drag = function (mouse) {
        var $$ = this, config = $$.config, main = $$.main, d3 = $$.d3;
        var sx, sy, mx, my, minX, maxX, minY, maxY;

        if ($$.hasArcType()) { return; }
        if (! config.data_selection_enabled) { return; } // do nothing if not selectable
        if (config.zoom_enabled && ! $$.zoom.altDomain) { return; } // skip if zoomable because of conflict drag dehavior
        if (!config.data_selection_multiple) { return; } // skip when single selection because drag is used for multiple selection

        sx = $$.dragStart[0];
        sy = $$.dragStart[1];
        mx = mouse[0];
        my = mouse[1];
        minX = Math.min(sx, mx);
        maxX = Math.max(sx, mx);
        minY = (config.data_selection_grouped) ? $$.margin.top : Math.min(sy, my);
        maxY = (config.data_selection_grouped) ? $$.height : Math.max(sy, my);

        main.select('.' + CLASS.dragarea)
            .attr('x', minX)
            .attr('y', minY)
            .attr('width', maxX - minX)
            .attr('height', maxY - minY);
        // TODO: binary search when multiple xs
        main.selectAll('.' + CLASS.shapes).selectAll('.' + CLASS.shape)
            .filter(function (d) { return config.data_selection_isselectable(d); })
            .each(function (d, i) {
                var shape = d3.select(this),
                    isSelected = shape.classed(CLASS.SELECTED),
                    isIncluded = shape.classed(CLASS.INCLUDED),
                    _x, _y, _w, _h, toggle, isWithin = false, box;
                if (shape.classed(CLASS.circle)) {
                    _x = shape.attr("cx") * 1;
                    _y = shape.attr("cy") * 1;
                    toggle = $$.togglePoint;
                    isWithin = minX < _x && _x < maxX && minY < _y && _y < maxY;
                }
                else if (shape.classed(CLASS.bar)) {
                    box = getPathBox(this);
                    _x = box.x;
                    _y = box.y;
                    _w = box.width;
                    _h = box.height;
                    toggle = $$.togglePath;
                    isWithin = !(maxX < _x || _x + _w < minX) && !(maxY < _y || _y + _h < minY);
                } else {
                    // line/area selection not supported yet
                    return;
                }
                if (isWithin ^ isIncluded) {
                    shape.classed(CLASS.INCLUDED, !isIncluded);
                    // TODO: included/unincluded callback here
                    shape.classed(CLASS.SELECTED, !isSelected);
                    toggle.call($$, !isSelected, shape, d, i);
                }
            });
    };

    c3_chart_internal_fn.dragstart = function (mouse) {
        var $$ = this, config = $$.config;
        if ($$.hasArcType()) { return; }
        if (! config.data_selection_enabled) { return; } // do nothing if not selectable
        $$.dragStart = mouse;
        $$.main.select('.' + CLASS.chart).append('rect')
            .attr('class', CLASS.dragarea)
            .style('opacity', 0.1);
        $$.dragging = true;
    };

    c3_chart_internal_fn.dragend = function () {
        var $$ = this, config = $$.config;
        if ($$.hasArcType()) { return; }
        if (! config.data_selection_enabled) { return; } // do nothing if not selectable
        $$.main.select('.' + CLASS.dragarea)
            .transition().duration(100)
            .style('opacity', 0)
            .remove();
        $$.main.selectAll('.' + CLASS.shape)
            .classed(CLASS.INCLUDED, false);
        $$.dragging = false;
    };

    c3_chart_internal_fn.selectPoint = function (target, d, i) {
        var $$ = this, config = $$.config,
            cx = (config.axis_rotated ? $$.circleY : $$.circleX).bind($$),
            cy = (config.axis_rotated ? $$.circleX : $$.circleY).bind($$),
            r = $$.pointSelectR.bind($$);
        config.data_onselected.call($$.api, d, target.node());
        // add selected-circle on low layer g
        $$.main.select('.' + CLASS.selectedCircles + $$.getTargetSelectorSuffix(d.id)).selectAll('.' + CLASS.selectedCircle + '-' + i)
            .data([d])
            .enter().append('circle')
            .attr("class", function () { return $$.generateClass(CLASS.selectedCircle, i); })
            .attr("cx", cx)
            .attr("cy", cy)
            .attr("stroke", function () { return $$.color(d); })
            .attr("r", function (d) { return $$.pointSelectR(d) * 1.4; })
            .transition().duration(100)
            .attr("r", r);
    };
    c3_chart_internal_fn.unselectPoint = function (target, d, i) {
        var $$ = this;
        $$.config.data_onunselected.call($$.api, d, target.node());
        // remove selected-circle from low layer g
        $$.main.select('.' + CLASS.selectedCircles + $$.getTargetSelectorSuffix(d.id)).selectAll('.' + CLASS.selectedCircle + '-' + i)
            .transition().duration(100).attr('r', 0)
            .remove();
    };
    c3_chart_internal_fn.togglePoint = function (selected, target, d, i) {
        selected ? this.selectPoint(target, d, i) : this.unselectPoint(target, d, i);
    };
    c3_chart_internal_fn.selectPath = function (target, d) {
        var $$ = this;
        $$.config.data_onselected.call($$, d, target.node());
        if ($$.config.interaction_brighten) {
            target.transition().duration(100)
                .style("fill", function () { return $$.d3.rgb($$.color(d)).brighter(0.75); });
        }
    };
    c3_chart_internal_fn.unselectPath = function (target, d) {
        var $$ = this;
        $$.config.data_onunselected.call($$, d, target.node());
        if ($$.config.interaction_brighten) {
            target.transition().duration(100)
                .style("fill", function () { return $$.color(d); });
        }
    };
    c3_chart_internal_fn.togglePath = function (selected, target, d, i) {
        selected ? this.selectPath(target, d, i) : this.unselectPath(target, d, i);
    };
    c3_chart_internal_fn.getToggle = function (that, d) {
        var $$ = this, toggle;
        if (that.nodeName === 'circle') {
            if ($$.isStepType(d)) {
                // circle is hidden in step chart, so treat as within the click area
                toggle = function () {}; // TODO: how to select step chart?
            } else {
                toggle = $$.togglePoint;
            }
        }
        else if (that.nodeName === 'path') {
            toggle = $$.togglePath;
        }
        return toggle;
    };
    c3_chart_internal_fn.toggleShape = function (that, d, i) {
        var $$ = this, d3 = $$.d3, config = $$.config,
            shape = d3.select(that), isSelected = shape.classed(CLASS.SELECTED),
            toggle = $$.getToggle(that, d).bind($$);

        if (config.data_selection_enabled && config.data_selection_isselectable(d)) {
            if (!config.data_selection_multiple) {
                $$.main.selectAll('.' + CLASS.shapes + (config.data_selection_grouped ? $$.getTargetSelectorSuffix(d.id) : "")).selectAll('.' + CLASS.shape).each(function (d, i) {
                    var shape = d3.select(this);
                    if (shape.classed(CLASS.SELECTED)) { toggle(false, shape.classed(CLASS.SELECTED, false), d, i); }
                });
            }
            shape.classed(CLASS.SELECTED, !isSelected);
            toggle(!isSelected, shape, d, i);
        }
    };

    c3_chart_internal_fn.initBrush = function () {
        var $$ = this, d3 = $$.d3;
        $$.brush = d3.svg.brush().on("brush", function () { $$.redrawForBrush(); });
        $$.brush.update = function () {
            if ($$.context) { $$.context.select('.' + CLASS.brush).call(this); }
            return this;
        };
        $$.brush.scale = function (scale) {
            return $$.config.axis_rotated ? this.y(scale) : this.x(scale);
        };
    };
    c3_chart_internal_fn.initSubchart = function () {
        var $$ = this, config = $$.config,
            context = $$.context = $$.svg.append("g").attr("transform", $$.getTranslate('context')),
            visibility = config.subchart_show ? 'visible' : 'hidden';

        context.style('visibility', visibility);

        // Define g for chart area
        context.append('g')
            .attr("clip-path", $$.clipPathForSubchart)
            .attr('class', CLASS.chart);

        // Define g for bar chart area
        context.select('.' + CLASS.chart).append("g")
            .attr("class", CLASS.chartBars);

        // Define g for line chart area
        context.select('.' + CLASS.chart).append("g")
            .attr("class", CLASS.chartLines);

        // Add extent rect for Brush
        context.append("g")
            .attr("clip-path", $$.clipPath)
            .attr("class", CLASS.brush)
            .call($$.brush);

        // ATTENTION: This must be called AFTER chart added
        // Add Axis
        $$.axes.subx = context.append("g")
            .attr("class", CLASS.axisX)
            .attr("transform", $$.getTranslate('subx'))
            .attr("clip-path", config.axis_rotated ? "" : $$.clipPathForXAxis)
            .style("visibility", config.subchart_axis_x_show ? visibility : 'hidden');
    };
    c3_chart_internal_fn.updateTargetsForSubchart = function (targets) {
        var $$ = this, context = $$.context, config = $$.config,
            contextLineEnter, contextLineUpdate, contextBarEnter, contextBarUpdate,
            classChartBar = $$.classChartBar.bind($$),
            classBars = $$.classBars.bind($$),
            classChartLine = $$.classChartLine.bind($$),
            classLines = $$.classLines.bind($$),
            classAreas = $$.classAreas.bind($$);

        if (config.subchart_show) {
            //-- Bar --//
            contextBarUpdate = context.select('.' + CLASS.chartBars).selectAll('.' + CLASS.chartBar)
                .data(targets)
                .attr('class', classChartBar);
            contextBarEnter = contextBarUpdate.enter().append('g')
                .style('opacity', 0)
                .attr('class', classChartBar);
            // Bars for each data
            contextBarEnter.append('g')
                .attr("class", classBars);

            //-- Line --//
            contextLineUpdate = context.select('.' + CLASS.chartLines).selectAll('.' + CLASS.chartLine)
                .data(targets)
                .attr('class', classChartLine);
            contextLineEnter = contextLineUpdate.enter().append('g')
                .style('opacity', 0)
                .attr('class', classChartLine);
            // Lines for each data
            contextLineEnter.append("g")
                .attr("class", classLines);
            // Area
            contextLineEnter.append("g")
                .attr("class", classAreas);

            //-- Brush --//
            context.selectAll('.' + CLASS.brush + ' rect')
                .attr(config.axis_rotated ? "width" : "height", config.axis_rotated ? $$.width2 : $$.height2);
        }
    };
    c3_chart_internal_fn.updateBarForSubchart = function (durationForExit) {
        var $$ = this;
        $$.contextBar = $$.context.selectAll('.' + CLASS.bars).selectAll('.' + CLASS.bar)
            .data($$.barData.bind($$));
        $$.contextBar.enter().append('path')
            .attr("class", $$.classBar.bind($$))
            .style("stroke", 'none')
            .style("fill", $$.color);
        $$.contextBar
            .style("opacity", $$.initialOpacity.bind($$));
        $$.contextBar.exit().transition().duration(durationForExit)
            .style('opacity', 0)
            .remove();
    };
    c3_chart_internal_fn.redrawBarForSubchart = function (drawBarOnSub, withTransition, duration) {
        (withTransition ? this.contextBar.transition(Math.random().toString()).duration(duration) : this.contextBar)
            .attr('d', drawBarOnSub)
            .style('opacity', 1);
    };
    c3_chart_internal_fn.updateLineForSubchart = function (durationForExit) {
        var $$ = this;
        $$.contextLine = $$.context.selectAll('.' + CLASS.lines).selectAll('.' + CLASS.line)
            .data($$.lineData.bind($$));
        $$.contextLine.enter().append('path')
            .attr('class', $$.classLine.bind($$))
            .style('stroke', $$.color);
        $$.contextLine
            .style("opacity", $$.initialOpacity.bind($$));
        $$.contextLine.exit().transition().duration(durationForExit)
            .style('opacity', 0)
            .remove();
    };
    c3_chart_internal_fn.redrawLineForSubchart = function (drawLineOnSub, withTransition, duration) {
        (withTransition ? this.contextLine.transition(Math.random().toString()).duration(duration) : this.contextLine)
            .attr("d", drawLineOnSub)
            .style('opacity', 1);
    };
    c3_chart_internal_fn.updateAreaForSubchart = function (durationForExit) {
        var $$ = this, d3 = $$.d3;
        $$.contextArea = $$.context.selectAll('.' + CLASS.areas).selectAll('.' + CLASS.area)
            .data($$.lineData.bind($$));
        $$.contextArea.enter().append('path')
            .attr("class", $$.classArea.bind($$))
            .style("fill", $$.color)
            .style("opacity", function () { $$.orgAreaOpacity = +d3.select(this).style('opacity'); return 0; });
        $$.contextArea
            .style("opacity", 0);
        $$.contextArea.exit().transition().duration(durationForExit)
            .style('opacity', 0)
            .remove();
    };
    c3_chart_internal_fn.redrawAreaForSubchart = function (drawAreaOnSub, withTransition, duration) {
        (withTransition ? this.contextArea.transition(Math.random().toString()).duration(duration) : this.contextArea)
            .attr("d", drawAreaOnSub)
            .style("fill", this.color)
            .style("opacity", this.orgAreaOpacity);
    };
    c3_chart_internal_fn.redrawSubchart = function (withSubchart, transitions, duration, durationForExit, areaIndices, barIndices, lineIndices) {
        var $$ = this, d3 = $$.d3, config = $$.config,
            drawAreaOnSub, drawBarOnSub, drawLineOnSub;

        $$.context.style('visibility', config.subchart_show ? 'visible' : 'hidden');

        // subchart
        if (config.subchart_show) {
            // reflect main chart to extent on subchart if zoomed
            if (d3.event && d3.event.type === 'zoom') {
                $$.brush.extent($$.x.orgDomain()).update();
            }
            // update subchart elements if needed
            if (withSubchart) {

                // extent rect
                if (!$$.brush.empty()) {
                    $$.brush.extent($$.x.orgDomain()).update();
                }
                // setup drawer - MEMO: this must be called after axis updated
                drawAreaOnSub = $$.generateDrawArea(areaIndices, true);
                drawBarOnSub = $$.generateDrawBar(barIndices, true);
                drawLineOnSub = $$.generateDrawLine(lineIndices, true);

                $$.updateBarForSubchart(duration);
                $$.updateLineForSubchart(duration);
                $$.updateAreaForSubchart(duration);

                $$.redrawBarForSubchart(drawBarOnSub, duration, duration);
                $$.redrawLineForSubchart(drawLineOnSub, duration, duration);
                $$.redrawAreaForSubchart(drawAreaOnSub, duration, duration);
            }
        }
    };
    c3_chart_internal_fn.redrawForBrush = function () {
        var $$ = this, x = $$.x;
        $$.redraw({
            withTransition: false,
            withY: $$.config.zoom_rescale,
            withSubchart: false,
            withUpdateXDomain: true,
            withDimension: false
        });
        $$.config.subchart_onbrush.call($$.api, x.orgDomain());
    };
    c3_chart_internal_fn.transformContext = function (withTransition, transitions) {
        var $$ = this, subXAxis;
        if (transitions && transitions.axisSubX) {
            subXAxis = transitions.axisSubX;
        } else {
            subXAxis = $$.context.select('.' + CLASS.axisX);
            if (withTransition) { subXAxis = subXAxis.transition(); }
        }
        $$.context.attr("transform", $$.getTranslate('context'));
        subXAxis.attr("transform", $$.getTranslate('subx'));
    };
    c3_chart_internal_fn.getDefaultExtent = function () {
        var $$ = this, config = $$.config,
            extent = isFunction(config.axis_x_extent) ? config.axis_x_extent($$.getXDomain($$.data.targets)) : config.axis_x_extent;
        if ($$.isTimeSeries()) {
            extent = [$$.parseDate(extent[0]), $$.parseDate(extent[1])];
        }
        return extent;
    };

    c3_chart_internal_fn.initZoom = function () {
        var $$ = this, d3 = $$.d3, config = $$.config, startEvent;

        $$.zoom = d3.behavior.zoom()
            .on("zoomstart", function () {
                startEvent = d3.event.sourceEvent;
                $$.zoom.altDomain = d3.event.sourceEvent.altKey ? $$.x.orgDomain() : null;
                config.zoom_onzoomstart.call($$.api, d3.event.sourceEvent);
            })
            .on("zoom", function () {
                $$.redrawForZoom.call($$);
            })
            .on('zoomend', function () {
                var event = d3.event.sourceEvent;
                // if click, do nothing. otherwise, click interaction will be canceled.
                if (event && startEvent.clientX === event.clientX && startEvent.clientY === event.clientY) {
                    return;
                }
                $$.redrawEventRect();
                $$.updateZoom();
                config.zoom_onzoomend.call($$.api, $$.x.orgDomain());
            });
        $$.zoom.scale = function (scale) {
            return config.axis_rotated ? this.y(scale) : this.x(scale);
        };
        $$.zoom.orgScaleExtent = function () {
            var extent = config.zoom_extent ? config.zoom_extent : [1, 10];
            return [extent[0], Math.max($$.getMaxDataCount() / extent[1], extent[1])];
        };
        $$.zoom.updateScaleExtent = function () {
            var ratio = diffDomain($$.x.orgDomain()) / diffDomain($$.getZoomDomain()),
                extent = this.orgScaleExtent();
            this.scaleExtent([extent[0] * ratio, extent[1] * ratio]);
            return this;
        };
    };
    c3_chart_internal_fn.getZoomDomain = function () {
        var $$ = this, config = $$.config, d3 = $$.d3,
            min = d3.min([$$.orgXDomain[0], config.zoom_x_min]),
            max = d3.max([$$.orgXDomain[1], config.zoom_x_max]);
        return [min, max];
    };
    c3_chart_internal_fn.updateZoom = function () {
        var $$ = this, z = $$.config.zoom_enabled ? $$.zoom : function () {};
        $$.main.select('.' + CLASS.zoomRect).call(z).on("dblclick.zoom", null);
        $$.main.selectAll('.' + CLASS.eventRect).call(z).on("dblclick.zoom", null);
    };
    c3_chart_internal_fn.redrawForZoom = function () {
        var $$ = this, d3 = $$.d3, config = $$.config, zoom = $$.zoom, x = $$.x;
        if (!config.zoom_enabled) {
            return;
        }
        if ($$.filterTargetsToShow($$.data.targets).length === 0) {
            return;
        }
        if (d3.event.sourceEvent.type === 'mousemove' && zoom.altDomain) {
            x.domain(zoom.altDomain);
            zoom.scale(x).updateScaleExtent();
            return;
        }
        if ($$.isCategorized() && x.orgDomain()[0] === $$.orgXDomain[0]) {
            x.domain([$$.orgXDomain[0] - 1e-10, x.orgDomain()[1]]);
        }
        $$.redraw({
            withTransition: false,
            withY: config.zoom_rescale,
            withSubchart: false,
            withEventRect: false,
            withDimension: false
        });
        if (d3.event.sourceEvent.type === 'mousemove') {
            $$.cancelClick = true;
        }
        config.zoom_onzoom.call($$.api, x.orgDomain());
    };

    c3_chart_internal_fn.generateColor = function () {
        var $$ = this, config = $$.config, d3 = $$.d3,
            colors = config.data_colors,
            pattern = notEmpty(config.color_pattern) ? config.color_pattern : d3.scale.category10().range(),
            callback = config.data_color,
            ids = [];

        return function (d) {
            var id = d.id || (d.data && d.data.id) || d, color;

            // if callback function is provided
            if (colors[id] instanceof Function) {
                color = colors[id](d);
            }
            // if specified, choose that color
            else if (colors[id]) {
                color = colors[id];
            }
            // if not specified, choose from pattern
            else {
                if (ids.indexOf(id) < 0) { ids.push(id); }
                color = pattern[ids.indexOf(id) % pattern.length];
                colors[id] = color;
            }
            return callback instanceof Function ? callback(color, d) : color;
        };
    };
    c3_chart_internal_fn.generateLevelColor = function () {
        var $$ = this, config = $$.config,
            colors = config.color_pattern,
            threshold = config.color_threshold,
            asValue = threshold.unit === 'value',
            values = threshold.values && threshold.values.length ? threshold.values : [],
            max = threshold.max || 100;
        return notEmpty(config.color_threshold) ? function (value) {
            var i, v, color = colors[colors.length - 1];
            for (i = 0; i < values.length; i++) {
                v = asValue ? value : (value * 100 / max);
                if (v < values[i]) {
                    color = colors[i];
                    break;
                }
            }
            return color;
        } : null;
    };

    c3_chart_internal_fn.getYFormat = function (forArc) {
        var $$ = this,
            formatForY = forArc && !$$.hasType('gauge') ? $$.defaultArcValueFormat : $$.yFormat,
            formatForY2 = forArc && !$$.hasType('gauge') ? $$.defaultArcValueFormat : $$.y2Format;
        return function (v, ratio, id) {
            var format = $$.axis.getId(id) === 'y2' ? formatForY2 : formatForY;
            return format.call($$, v, ratio);
        };
    };
    c3_chart_internal_fn.yFormat = function (v) {
        var $$ = this, config = $$.config,
            format = config.axis_y_tick_format ? config.axis_y_tick_format : $$.defaultValueFormat;
        return format(v);
    };
    c3_chart_internal_fn.y2Format = function (v) {
        var $$ = this, config = $$.config,
            format = config.axis_y2_tick_format ? config.axis_y2_tick_format : $$.defaultValueFormat;
        return format(v);
    };
    c3_chart_internal_fn.defaultValueFormat = function (v) {
        return isValue(v) ? +v : "";
    };
    c3_chart_internal_fn.defaultArcValueFormat = function (v, ratio) {
        return (ratio * 100).toFixed(1) + '%';
    };
    c3_chart_internal_fn.dataLabelFormat = function (targetId) {
        var $$ = this, data_labels = $$.config.data_labels,
            format, defaultFormat = function (v) { return isValue(v) ? +v : ""; };
        // find format according to axis id
        if (typeof data_labels.format === 'function') {
            format = data_labels.format;
        } else if (typeof data_labels.format === 'object') {
            if (data_labels.format[targetId]) {
                format = data_labels.format[targetId] === true ? defaultFormat : data_labels.format[targetId];
            } else {
                format = function () { return ''; };
            }
        } else {
            format = defaultFormat;
        }
        return format;
    };

    c3_chart_internal_fn.hasCaches = function (ids) {
        for (var i = 0; i < ids.length; i++) {
            if (! (ids[i] in this.cache)) { return false; }
        }
        return true;
    };
    c3_chart_internal_fn.addCache = function (id, target) {
        this.cache[id] = this.cloneTarget(target);
    };
    c3_chart_internal_fn.getCaches = function (ids) {
        var targets = [], i;
        for (i = 0; i < ids.length; i++) {
            if (ids[i] in this.cache) { targets.push(this.cloneTarget(this.cache[ids[i]])); }
        }
        return targets;
    };

    var CLASS = c3_chart_internal_fn.CLASS = {
        target: 'c3-target',
        chart: 'c3-chart',
        chartLine: 'c3-chart-line',
        chartLines: 'c3-chart-lines',
        chartBar: 'c3-chart-bar',
        chartBars: 'c3-chart-bars',
        chartText: 'c3-chart-text',
        chartTexts: 'c3-chart-texts',
        chartArc: 'c3-chart-arc',
        chartArcs: 'c3-chart-arcs',
        chartArcsTitle: 'c3-chart-arcs-title',
        chartArcsBackground: 'c3-chart-arcs-background',
        chartArcsGaugeUnit: 'c3-chart-arcs-gauge-unit',
        chartArcsGaugeMax: 'c3-chart-arcs-gauge-max',
        chartArcsGaugeMin: 'c3-chart-arcs-gauge-min',
        selectedCircle: 'c3-selected-circle',
        selectedCircles: 'c3-selected-circles',
        eventRect: 'c3-event-rect',
        eventRects: 'c3-event-rects',
        eventRectsSingle: 'c3-event-rects-single',
        eventRectsMultiple: 'c3-event-rects-multiple',
        zoomRect: 'c3-zoom-rect',
        brush: 'c3-brush',
        focused: 'c3-focused',
        defocused: 'c3-defocused',
        region: 'c3-region',
        regions: 'c3-regions',
        title: 'c3-title',
        tooltipContainer: 'c3-tooltip-container',
        tooltip: 'c3-tooltip',
        tooltipName: 'c3-tooltip-name',
        shape: 'c3-shape',
        shapes: 'c3-shapes',
        line: 'c3-line',
        lines: 'c3-lines',
        bar: 'c3-bar',
        bars: 'c3-bars',
        circle: 'c3-circle',
        circles: 'c3-circles',
        arc: 'c3-arc',
        arcs: 'c3-arcs',
        area: 'c3-area',
        areas: 'c3-areas',
        empty: 'c3-empty',
        text: 'c3-text',
        texts: 'c3-texts',
        gaugeValue: 'c3-gauge-value',
        grid: 'c3-grid',
        gridLines: 'c3-grid-lines',
        xgrid: 'c3-xgrid',
        xgrids: 'c3-xgrids',
        xgridLine: 'c3-xgrid-line',
        xgridLines: 'c3-xgrid-lines',
        xgridFocus: 'c3-xgrid-focus',
        ygrid: 'c3-ygrid',
        ygrids: 'c3-ygrids',
        ygridLine: 'c3-ygrid-line',
        ygridLines: 'c3-ygrid-lines',
        axis: 'c3-axis',
        axisX: 'c3-axis-x',
        axisXLabel: 'c3-axis-x-label',
        axisY: 'c3-axis-y',
        axisYLabel: 'c3-axis-y-label',
        axisY2: 'c3-axis-y2',
        axisY2Label: 'c3-axis-y2-label',
        legendBackground: 'c3-legend-background',
        legendItem: 'c3-legend-item',
        legendItemEvent: 'c3-legend-item-event',
        legendItemTile: 'c3-legend-item-tile',
        legendItemHidden: 'c3-legend-item-hidden',
        legendItemFocused: 'c3-legend-item-focused',
        dragarea: 'c3-dragarea',
        EXPANDED: '_expanded_',
        SELECTED: '_selected_',
        INCLUDED: '_included_'
    };
    c3_chart_internal_fn.generateClass = function (prefix, targetId) {
        return " " + prefix + " " + prefix + this.getTargetSelectorSuffix(targetId);
    };
    c3_chart_internal_fn.classText = function (d) {
        return this.generateClass(CLASS.text, d.index);
    };
    c3_chart_internal_fn.classTexts = function (d) {
        return this.generateClass(CLASS.texts, d.id);
    };
    c3_chart_internal_fn.classShape = function (d) {
        return this.generateClass(CLASS.shape, d.index);
    };
    c3_chart_internal_fn.classShapes = function (d) {
        return this.generateClass(CLASS.shapes, d.id);
    };
    c3_chart_internal_fn.classLine = function (d) {
        return this.classShape(d) + this.generateClass(CLASS.line, d.id);
    };
    c3_chart_internal_fn.classLines = function (d) {
        return this.classShapes(d) + this.generateClass(CLASS.lines, d.id);
    };
    c3_chart_internal_fn.classCircle = function (d) {
        return this.classShape(d) + this.generateClass(CLASS.circle, d.index);
    };
    c3_chart_internal_fn.classCircles = function (d) {
        return this.classShapes(d) + this.generateClass(CLASS.circles, d.id);
    };
    c3_chart_internal_fn.classBar = function (d) {
        return this.classShape(d) + this.generateClass(CLASS.bar, d.index);
    };
    c3_chart_internal_fn.classBars = function (d) {
        return this.classShapes(d) + this.generateClass(CLASS.bars, d.id);
    };
    c3_chart_internal_fn.classArc = function (d) {
        return this.classShape(d.data) + this.generateClass(CLASS.arc, d.data.id);
    };
    c3_chart_internal_fn.classArcs = function (d) {
        return this.classShapes(d.data) + this.generateClass(CLASS.arcs, d.data.id);
    };
    c3_chart_internal_fn.classArea = function (d) {
        return this.classShape(d) + this.generateClass(CLASS.area, d.id);
    };
    c3_chart_internal_fn.classAreas = function (d) {
        return this.classShapes(d) + this.generateClass(CLASS.areas, d.id);
    };
    c3_chart_internal_fn.classRegion = function (d, i) {
        return this.generateClass(CLASS.region, i) + ' ' + ('class' in d ? d['class'] : '');
    };
    c3_chart_internal_fn.classEvent = function (d) {
        return this.generateClass(CLASS.eventRect, d.index);
    };
    c3_chart_internal_fn.classTarget = function (id) {
        var $$ = this;
        var additionalClassSuffix = $$.config.data_classes[id], additionalClass = '';
        if (additionalClassSuffix) {
            additionalClass = ' ' + CLASS.target + '-' + additionalClassSuffix;
        }
        return $$.generateClass(CLASS.target, id) + additionalClass;
    };
    c3_chart_internal_fn.classFocus = function (d) {
        return this.classFocused(d) + this.classDefocused(d);
    };
    c3_chart_internal_fn.classFocused = function (d) {
        return ' ' + (this.focusedTargetIds.indexOf(d.id) >= 0 ? CLASS.focused : '');
    };
    c3_chart_internal_fn.classDefocused = function (d) {
        return ' ' + (this.defocusedTargetIds.indexOf(d.id) >= 0 ? CLASS.defocused : '');
    };
    c3_chart_internal_fn.classChartText = function (d) {
        return CLASS.chartText + this.classTarget(d.id);
    };
    c3_chart_internal_fn.classChartLine = function (d) {
        return CLASS.chartLine + this.classTarget(d.id);
    };
    c3_chart_internal_fn.classChartBar = function (d) {
        return CLASS.chartBar + this.classTarget(d.id);
    };
    c3_chart_internal_fn.classChartArc = function (d) {
        return CLASS.chartArc + this.classTarget(d.data.id);
    };
    c3_chart_internal_fn.getTargetSelectorSuffix = function (targetId) {
        return targetId || targetId === 0 ? ('-' + targetId).replace(/[\s?!@#$%^&*()_=+,.<>'":;\[\]\/|~`{}\\]/g, '-') : '';
    };
    c3_chart_internal_fn.selectorTarget = function (id, prefix) {
        return (prefix || '') + '.' + CLASS.target + this.getTargetSelectorSuffix(id);
    };
    c3_chart_internal_fn.selectorTargets = function (ids, prefix) {
        var $$ = this;
        ids = ids || [];
        return ids.length ? ids.map(function (id) { return $$.selectorTarget(id, prefix); }) : null;
    };
    c3_chart_internal_fn.selectorLegend = function (id) {
        return '.' + CLASS.legendItem + this.getTargetSelectorSuffix(id);
    };
    c3_chart_internal_fn.selectorLegends = function (ids) {
        var $$ = this;
        return ids && ids.length ? ids.map(function (id) { return $$.selectorLegend(id); }) : null;
    };

    var isValue = c3_chart_internal_fn.isValue = function (v) {
        return v || v === 0;
    },
        isFunction = c3_chart_internal_fn.isFunction = function (o) {
            return typeof o === 'function';
        },
        isString = c3_chart_internal_fn.isString = function (o) {
            return typeof o === 'string';
        },
        isUndefined = c3_chart_internal_fn.isUndefined = function (v) {
            return typeof v === 'undefined';
        },
        isDefined = c3_chart_internal_fn.isDefined = function (v) {
            return typeof v !== 'undefined';
        },
        ceil10 = c3_chart_internal_fn.ceil10 = function (v) {
            return Math.ceil(v / 10) * 10;
        },
        asHalfPixel = c3_chart_internal_fn.asHalfPixel = function (n) {
            return Math.ceil(n) + 0.5;
        },
        diffDomain = c3_chart_internal_fn.diffDomain = function (d) {
            return d[1] - d[0];
        },
        isEmpty = c3_chart_internal_fn.isEmpty = function (o) {
            return typeof o === 'undefined' || o === null || (isString(o) && o.length === 0) || (typeof o === 'object' && Object.keys(o).length === 0);
        },
        notEmpty = c3_chart_internal_fn.notEmpty = function (o) {
            return !c3_chart_internal_fn.isEmpty(o);
        },
        getOption = c3_chart_internal_fn.getOption = function (options, key, defaultValue) {
            return isDefined(options[key]) ? options[key] : defaultValue;
        },
        hasValue = c3_chart_internal_fn.hasValue = function (dict, value) {
            var found = false;
            Object.keys(dict).forEach(function (key) {
                if (dict[key] === value) { found = true; }
            });
            return found;
        },
        sanitise = c3_chart_internal_fn.sanitise = function (str) {
            return typeof str === 'string' ? str.replace(/</g, '&lt;').replace(/>/g, '&gt;') : str;
        },
        getPathBox = c3_chart_internal_fn.getPathBox = function (path) {
            var box = path.getBoundingClientRect(),
                items = [path.pathSegList.getItem(0), path.pathSegList.getItem(1)],
                minX = items[0].x, minY = Math.min(items[0].y, items[1].y);
            return {x: minX, y: minY, width: box.width, height: box.height};
        };

    c3_chart_fn.focus = function (targetIds) {
        var $$ = this.internal, candidates;

        targetIds = $$.mapToTargetIds(targetIds);
        candidates = $$.svg.selectAll($$.selectorTargets(targetIds.filter($$.isTargetToShow, $$))),

        this.revert();
        this.defocus();
        candidates.classed(CLASS.focused, true).classed(CLASS.defocused, false);
        if ($$.hasArcType()) {
            $$.expandArc(targetIds);
        }
        $$.toggleFocusLegend(targetIds, true);

        $$.focusedTargetIds = targetIds;
        $$.defocusedTargetIds = $$.defocusedTargetIds.filter(function (id) {
            return targetIds.indexOf(id) < 0;
        });
    };

    c3_chart_fn.defocus = function (targetIds) {
        var $$ = this.internal, candidates;

        targetIds = $$.mapToTargetIds(targetIds);
        candidates = $$.svg.selectAll($$.selectorTargets(targetIds.filter($$.isTargetToShow, $$))),

        candidates.classed(CLASS.focused, false).classed(CLASS.defocused, true);
        if ($$.hasArcType()) {
            $$.unexpandArc(targetIds);
        }
        $$.toggleFocusLegend(targetIds, false);

        $$.focusedTargetIds = $$.focusedTargetIds.filter(function (id) {
            return targetIds.indexOf(id) < 0;
        });
        $$.defocusedTargetIds = targetIds;
    };

    c3_chart_fn.revert = function (targetIds) {
        var $$ = this.internal, candidates;

        targetIds = $$.mapToTargetIds(targetIds);
        candidates = $$.svg.selectAll($$.selectorTargets(targetIds)); // should be for all targets

        candidates.classed(CLASS.focused, false).classed(CLASS.defocused, false);
        if ($$.hasArcType()) {
            $$.unexpandArc(targetIds);
        }
        if ($$.config.legend_show) {
            $$.showLegend(targetIds.filter($$.isLegendToShow.bind($$)));
            $$.legend.selectAll($$.selectorLegends(targetIds))
                .filter(function () {
                    return $$.d3.select(this).classed(CLASS.legendItemFocused);
                })
                .classed(CLASS.legendItemFocused, false);
        }

        $$.focusedTargetIds = [];
        $$.defocusedTargetIds = [];
    };

    c3_chart_fn.show = function (targetIds, options) {
        var $$ = this.internal, targets;

        targetIds = $$.mapToTargetIds(targetIds);
        options = options || {};

        $$.removeHiddenTargetIds(targetIds);
        targets = $$.svg.selectAll($$.selectorTargets(targetIds));

        targets.transition()
            .style('opacity', 1, 'important')
            .call($$.endall, function () {
                targets.style('opacity', null).style('opacity', 1);
            });

        if (options.withLegend) {
            $$.showLegend(targetIds);
        }

        $$.redraw({withUpdateOrgXDomain: true, withUpdateXDomain: true, withLegend: true});
    };

    c3_chart_fn.hide = function (targetIds, options) {
        var $$ = this.internal, targets;

        targetIds = $$.mapToTargetIds(targetIds);
        options = options || {};

        $$.addHiddenTargetIds(targetIds);
        targets = $$.svg.selectAll($$.selectorTargets(targetIds));

        targets.transition()
            .style('opacity', 0, 'important')
            .call($$.endall, function () {
                targets.style('opacity', null).style('opacity', 0);
            });

        if (options.withLegend) {
            $$.hideLegend(targetIds);
        }

        $$.redraw({withUpdateOrgXDomain: true, withUpdateXDomain: true, withLegend: true});
    };

    c3_chart_fn.toggle = function (targetIds, options) {
        var that = this, $$ = this.internal;
        $$.mapToTargetIds(targetIds).forEach(function (targetId) {
            $$.isTargetToShow(targetId) ? that.hide(targetId, options) : that.show(targetId, options);
        });
    };

    c3_chart_fn.zoom = function (domain) {
        var $$ = this.internal;
        if (domain) {
            if ($$.isTimeSeries()) {
                domain = domain.map(function (x) { return $$.parseDate(x); });
            }
            $$.brush.extent(domain);
            $$.redraw({withUpdateXDomain: true, withY: $$.config.zoom_rescale});
            $$.config.zoom_onzoom.call(this, $$.x.orgDomain());
        }
        return $$.brush.extent();
    };
    c3_chart_fn.zoom.enable = function (enabled) {
        var $$ = this.internal;
        $$.config.zoom_enabled = enabled;
        $$.updateAndRedraw();
    };
    c3_chart_fn.unzoom = function () {
        var $$ = this.internal;
        $$.brush.clear().update();
        $$.redraw({withUpdateXDomain: true});
    };

    c3_chart_fn.zoom.max = function (max) {
        var $$ = this.internal, config = $$.config, d3 = $$.d3;
        if (max === 0 || max) {
            config.zoom_x_max = d3.max([$$.orgXDomain[1], max]);
        }
        else {
            return config.zoom_x_max;
        }
    };

    c3_chart_fn.zoom.min = function (min) {
        var $$ = this.internal, config = $$.config, d3 = $$.d3;
        if (min === 0 || min) {
            config.zoom_x_min = d3.min([$$.orgXDomain[0], min]);
        }
        else {
            return config.zoom_x_min;
        }
    };

    c3_chart_fn.zoom.range = function (range) {
        if (arguments.length) {
            if (isDefined(range.max)) { this.domain.max(range.max); }
            if (isDefined(range.min)) { this.domain.min(range.min); }
        } else {
            return {
                max: this.domain.max(),
                min: this.domain.min()
            };
        }
    };

    c3_chart_fn.load = function (args) {
        var $$ = this.internal, config = $$.config;
        // update xs if specified
        if (args.xs) {
            $$.addXs(args.xs);
        }
        // update names if exists
        if ('names' in args) {
            c3_chart_fn.data.names.bind(this)(args.names);
        }
        // update classes if exists
        if ('classes' in args) {
            Object.keys(args.classes).forEach(function (id) {
                config.data_classes[id] = args.classes[id];
            });
        }
        // update categories if exists
        if ('categories' in args && $$.isCategorized()) {
            config.axis_x_categories = args.categories;
        }
        // update axes if exists
        if ('axes' in args) {
            Object.keys(args.axes).forEach(function (id) {
                config.data_axes[id] = args.axes[id];
            });
        }
        // update colors if exists
        if ('colors' in args) {
            Object.keys(args.colors).forEach(function (id) {
                config.data_colors[id] = args.colors[id];
            });
        }
        // use cache if exists
        if ('cacheIds' in args && $$.hasCaches(args.cacheIds)) {
            $$.load($$.getCaches(args.cacheIds), args.done);
            return;
        }
        // unload if needed
        if ('unload' in args) {
            // TODO: do not unload if target will load (included in url/rows/columns)
            $$.unload($$.mapToTargetIds((typeof args.unload === 'boolean' && args.unload) ? null : args.unload), function () {
                $$.loadFromArgs(args);
            });
        } else {
            $$.loadFromArgs(args);
        }
    };

    c3_chart_fn.unload = function (args) {
        var $$ = this.internal;
        args = args || {};
        if (args instanceof Array) {
            args = {ids: args};
        } else if (typeof args === 'string') {
            args = {ids: [args]};
        }
        $$.unload($$.mapToTargetIds(args.ids), function () {
            $$.redraw({withUpdateOrgXDomain: true, withUpdateXDomain: true, withLegend: true});
            if (args.done) { args.done(); }
        });
    };

    c3_chart_fn.flow = function (args) {
        var $$ = this.internal,
            targets, data, notfoundIds = [], orgDataCount = $$.getMaxDataCount(),
            dataCount, domain, baseTarget, baseValue, length = 0, tail = 0, diff, to;

        if (args.json) {
            data = $$.convertJsonToData(args.json, args.keys);
        }
        else if (args.rows) {
            data = $$.convertRowsToData(args.rows);
        }
        else if (args.columns) {
            data = $$.convertColumnsToData(args.columns);
        }
        else {
            return;
        }
        targets = $$.convertDataToTargets(data, true);

        // Update/Add data
        $$.data.targets.forEach(function (t) {
            var found = false, i, j;
            for (i = 0; i < targets.length; i++) {
                if (t.id === targets[i].id) {
                    found = true;

                    if (t.values[t.values.length - 1]) {
                        tail = t.values[t.values.length - 1].index + 1;
                    }
                    length = targets[i].values.length;

                    for (j = 0; j < length; j++) {
                        targets[i].values[j].index = tail + j;
                        if (!$$.isTimeSeries()) {
                            targets[i].values[j].x = tail + j;
                        }
                    }
                    t.values = t.values.concat(targets[i].values);

                    targets.splice(i, 1);
                    break;
                }
            }
            if (!found) { notfoundIds.push(t.id); }
        });

        // Append null for not found targets
        $$.data.targets.forEach(function (t) {
            var i, j;
            for (i = 0; i < notfoundIds.length; i++) {
                if (t.id === notfoundIds[i]) {
                    tail = t.values[t.values.length - 1].index + 1;
                    for (j = 0; j < length; j++) {
                        t.values.push({
                            id: t.id,
                            index: tail + j,
                            x: $$.isTimeSeries() ? $$.getOtherTargetX(tail + j) : tail + j,
                            value: null
                        });
                    }
                }
            }
        });

        // Generate null values for new target
        if ($$.data.targets.length) {
            targets.forEach(function (t) {
                var i, missing = [];
                for (i = $$.data.targets[0].values[0].index; i < tail; i++) {
                    missing.push({
                        id: t.id,
                        index: i,
                        x: $$.isTimeSeries() ? $$.getOtherTargetX(i) : i,
                        value: null
                    });
                }
                t.values.forEach(function (v) {
                    v.index += tail;
                    if (!$$.isTimeSeries()) {
                        v.x += tail;
                    }
                });
                t.values = missing.concat(t.values);
            });
        }
        $$.data.targets = $$.data.targets.concat(targets); // add remained

        // check data count because behavior needs to change when it's only one
        dataCount = $$.getMaxDataCount();
        baseTarget = $$.data.targets[0];
        baseValue = baseTarget.values[0];

        // Update length to flow if needed
        if (isDefined(args.to)) {
            length = 0;
            to = $$.isTimeSeries() ? $$.parseDate(args.to) : args.to;
            baseTarget.values.forEach(function (v) {
                if (v.x < to) { length++; }
            });
        } else if (isDefined(args.length)) {
            length = args.length;
        }

        // If only one data, update the domain to flow from left edge of the chart
        if (!orgDataCount) {
            if ($$.isTimeSeries()) {
                if (baseTarget.values.length > 1) {
                    diff = baseTarget.values[baseTarget.values.length - 1].x - baseValue.x;
                } else {
                    diff = baseValue.x - $$.getXDomain($$.data.targets)[0];
                }
            } else {
                diff = 1;
            }
            domain = [baseValue.x - diff, baseValue.x];
            $$.updateXDomain(null, true, true, false, domain);
        } else if (orgDataCount === 1) {
            if ($$.isTimeSeries()) {
                diff = (baseTarget.values[baseTarget.values.length - 1].x - baseValue.x) / 2;
                domain = [new Date(+baseValue.x - diff), new Date(+baseValue.x + diff)];
                $$.updateXDomain(null, true, true, false, domain);
            }
        }

        // Set targets
        $$.updateTargets($$.data.targets);

        // Redraw with new targets
        $$.redraw({
            flow: {
                index: baseValue.index,
                length: length,
                duration: isValue(args.duration) ? args.duration : $$.config.transition_duration,
                done: args.done,
                orgDataCount: orgDataCount,
            },
            withLegend: true,
            withTransition: orgDataCount > 1,
            withTrimXDomain: false,
            withUpdateXAxis: true,
        });
    };

    c3_chart_internal_fn.generateFlow = function (args) {
        var $$ = this, config = $$.config, d3 = $$.d3;

        return function () {
            var targets = args.targets,
                flow = args.flow,
                drawBar = args.drawBar,
                drawLine = args.drawLine,
                drawArea = args.drawArea,
                cx = args.cx,
                cy = args.cy,
                xv = args.xv,
                xForText = args.xForText,
                yForText = args.yForText,
                duration = args.duration;

            var translateX, scaleX = 1, transform,
                flowIndex = flow.index,
                flowLength = flow.length,
                flowStart = $$.getValueOnIndex($$.data.targets[0].values, flowIndex),
                flowEnd = $$.getValueOnIndex($$.data.targets[0].values, flowIndex + flowLength),
                orgDomain = $$.x.domain(), domain,
                durationForFlow = flow.duration || duration,
                done = flow.done || function () {},
                wait = $$.generateWait();

            var xgrid = $$.xgrid || d3.selectAll([]),
                xgridLines = $$.xgridLines || d3.selectAll([]),
                mainRegion = $$.mainRegion || d3.selectAll([]),
                mainText = $$.mainText || d3.selectAll([]),
                mainBar = $$.mainBar || d3.selectAll([]),
                mainLine = $$.mainLine || d3.selectAll([]),
                mainArea = $$.mainArea || d3.selectAll([]),
                mainCircle = $$.mainCircle || d3.selectAll([]);

            // set flag
            $$.flowing = true;

            // remove head data after rendered
            $$.data.targets.forEach(function (d) {
                d.values.splice(0, flowLength);
            });

            // update x domain to generate axis elements for flow
            domain = $$.updateXDomain(targets, true, true);
            // update elements related to x scale
            if ($$.updateXGrid) { $$.updateXGrid(true); }

            // generate transform to flow
            if (!flow.orgDataCount) { // if empty
                if ($$.data.targets[0].values.length !== 1) {
                    translateX = $$.x(orgDomain[0]) - $$.x(domain[0]);
                } else {
                    if ($$.isTimeSeries()) {
                        flowStart = $$.getValueOnIndex($$.data.targets[0].values, 0);
                        flowEnd = $$.getValueOnIndex($$.data.targets[0].values, $$.data.targets[0].values.length - 1);
                        translateX = $$.x(flowStart.x) - $$.x(flowEnd.x);
                    } else {
                        translateX = diffDomain(domain) / 2;
                    }
                }
            } else if (flow.orgDataCount === 1 || (flowStart && flowStart.x) === (flowEnd && flowEnd.x)) {
                translateX = $$.x(orgDomain[0]) - $$.x(domain[0]);
            } else {
                if ($$.isTimeSeries()) {
                    translateX = ($$.x(orgDomain[0]) - $$.x(domain[0]));
                } else {
                    translateX = ($$.x(flowStart.x) - $$.x(flowEnd.x));
                }
            }
            scaleX = (diffDomain(orgDomain) / diffDomain(domain));
            transform = 'translate(' + translateX + ',0) scale(' + scaleX + ',1)';

            $$.hideXGridFocus();

            d3.transition().ease('linear').duration(durationForFlow).each(function () {
                wait.add($$.axes.x.transition().call($$.xAxis));
                wait.add(mainBar.transition().attr('transform', transform));
                wait.add(mainLine.transition().attr('transform', transform));
                wait.add(mainArea.transition().attr('transform', transform));
                wait.add(mainCircle.transition().attr('transform', transform));
                wait.add(mainText.transition().attr('transform', transform));
                wait.add(mainRegion.filter($$.isRegionOnX).transition().attr('transform', transform));
                wait.add(xgrid.transition().attr('transform', transform));
                wait.add(xgridLines.transition().attr('transform', transform));
            })
            .call(wait, function () {
                var i, shapes = [], texts = [], eventRects = [];

                // remove flowed elements
                if (flowLength) {
                    for (i = 0; i < flowLength; i++) {
                        shapes.push('.' + CLASS.shape + '-' + (flowIndex + i));
                        texts.push('.' + CLASS.text + '-' + (flowIndex + i));
                        eventRects.push('.' + CLASS.eventRect + '-' + (flowIndex + i));
                    }
                    $$.svg.selectAll('.' + CLASS.shapes).selectAll(shapes).remove();
                    $$.svg.selectAll('.' + CLASS.texts).selectAll(texts).remove();
                    $$.svg.selectAll('.' + CLASS.eventRects).selectAll(eventRects).remove();
                    $$.svg.select('.' + CLASS.xgrid).remove();
                }

                // draw again for removing flowed elements and reverting attr
                xgrid
                    .attr('transform', null)
                    .attr($$.xgridAttr);
                xgridLines
                    .attr('transform', null);
                xgridLines.select('line')
                    .attr("x1", config.axis_rotated ? 0 : xv)
                    .attr("x2", config.axis_rotated ? $$.width : xv);
                xgridLines.select('text')
                    .attr("x", config.axis_rotated ? $$.width : 0)
                    .attr("y", xv);
                mainBar
                    .attr('transform', null)
                    .attr("d", drawBar);
                mainLine
                    .attr('transform', null)
                    .attr("d", drawLine);
                mainArea
                    .attr('transform', null)
                    .attr("d", drawArea);
                mainCircle
                    .attr('transform', null)
                    .attr("cx", cx)
                    .attr("cy", cy);
                mainText
                    .attr('transform', null)
                    .attr('x', xForText)
                    .attr('y', yForText)
                    .style('fill-opacity', $$.opacityForText.bind($$));
                mainRegion
                    .attr('transform', null);
                mainRegion.select('rect').filter($$.isRegionOnX)
                    .attr("x", $$.regionX.bind($$))
                    .attr("width", $$.regionWidth.bind($$));

                if (config.interaction_enabled) {
                    $$.redrawEventRect();
                }

                // callback for end of flow
                done();

                $$.flowing = false;
            });
        };
    };

    c3_chart_fn.selected = function (targetId) {
        var $$ = this.internal, d3 = $$.d3;
        return d3.merge(
            $$.main.selectAll('.' + CLASS.shapes + $$.getTargetSelectorSuffix(targetId)).selectAll('.' + CLASS.shape)
                .filter(function () { return d3.select(this).classed(CLASS.SELECTED); })
                .map(function (d) { return d.map(function (d) { var data = d.__data__; return data.data ? data.data : data; }); })
        );
    };
    c3_chart_fn.select = function (ids, indices, resetOther) {
        var $$ = this.internal, d3 = $$.d3, config = $$.config;
        if (! config.data_selection_enabled) { return; }
        $$.main.selectAll('.' + CLASS.shapes).selectAll('.' + CLASS.shape).each(function (d, i) {
            var shape = d3.select(this), id = d.data ? d.data.id : d.id,
                toggle = $$.getToggle(this, d).bind($$),
                isTargetId = config.data_selection_grouped || !ids || ids.indexOf(id) >= 0,
                isTargetIndex = !indices || indices.indexOf(i) >= 0,
                isSelected = shape.classed(CLASS.SELECTED);
            // line/area selection not supported yet
            if (shape.classed(CLASS.line) || shape.classed(CLASS.area)) {
                return;
            }
            if (isTargetId && isTargetIndex) {
                if (config.data_selection_isselectable(d) && !isSelected) {
                    toggle(true, shape.classed(CLASS.SELECTED, true), d, i);
                }
            } else if (isDefined(resetOther) && resetOther) {
                if (isSelected) {
                    toggle(false, shape.classed(CLASS.SELECTED, false), d, i);
                }
            }
        });
    };
    c3_chart_fn.unselect = function (ids, indices) {
        var $$ = this.internal, d3 = $$.d3, config = $$.config;
        if (! config.data_selection_enabled) { return; }
        $$.main.selectAll('.' + CLASS.shapes).selectAll('.' + CLASS.shape).each(function (d, i) {
            var shape = d3.select(this), id = d.data ? d.data.id : d.id,
                toggle = $$.getToggle(this, d).bind($$),
                isTargetId = config.data_selection_grouped || !ids || ids.indexOf(id) >= 0,
                isTargetIndex = !indices || indices.indexOf(i) >= 0,
                isSelected = shape.classed(CLASS.SELECTED);
            // line/area selection not supported yet
            if (shape.classed(CLASS.line) || shape.classed(CLASS.area)) {
                return;
            }
            if (isTargetId && isTargetIndex) {
                if (config.data_selection_isselectable(d)) {
                    if (isSelected) {
                        toggle(false, shape.classed(CLASS.SELECTED, false), d, i);
                    }
                }
            }
        });
    };

    c3_chart_fn.transform = function (type, targetIds) {
        var $$ = this.internal,
            options = ['pie', 'donut'].indexOf(type) >= 0 ? {withTransform: true} : null;
        $$.transformTo(targetIds, type, options);
    };

    c3_chart_internal_fn.transformTo = function (targetIds, type, optionsForRedraw) {
        var $$ = this,
            withTransitionForAxis = !$$.hasArcType(),
            options = optionsForRedraw || {withTransitionForAxis: withTransitionForAxis};
        options.withTransitionForTransform = false;
        $$.transiting = false;
        $$.setTargetType(targetIds, type);
        $$.updateTargets($$.data.targets); // this is needed when transforming to arc
        $$.updateAndRedraw(options);
    };

    c3_chart_fn.groups = function (groups) {
        var $$ = this.internal, config = $$.config;
        if (isUndefined(groups)) { return config.data_groups; }
        config.data_groups = groups;
        $$.redraw();
        return config.data_groups;
    };

    c3_chart_fn.xgrids = function (grids) {
        var $$ = this.internal, config = $$.config;
        if (! grids) { return config.grid_x_lines; }
        config.grid_x_lines = grids;
        $$.redrawWithoutRescale();
        return config.grid_x_lines;
    };
    c3_chart_fn.xgrids.add = function (grids) {
        var $$ = this.internal;
        return this.xgrids($$.config.grid_x_lines.concat(grids ? grids : []));
    };
    c3_chart_fn.xgrids.remove = function (params) { // TODO: multiple
        var $$ = this.internal;
        $$.removeGridLines(params, true);
    };

    c3_chart_fn.ygrids = function (grids) {
        var $$ = this.internal, config = $$.config;
        if (! grids) { return config.grid_y_lines; }
        config.grid_y_lines = grids;
        $$.redrawWithoutRescale();
        return config.grid_y_lines;
    };
    c3_chart_fn.ygrids.add = function (grids) {
        var $$ = this.internal;
        return this.ygrids($$.config.grid_y_lines.concat(grids ? grids : []));
    };
    c3_chart_fn.ygrids.remove = function (params) { // TODO: multiple
        var $$ = this.internal;
        $$.removeGridLines(params, false);
    };

    c3_chart_fn.regions = function (regions) {
        var $$ = this.internal, config = $$.config;
        if (!regions) { return config.regions; }
        config.regions = regions;
        $$.redrawWithoutRescale();
        return config.regions;
    };
    c3_chart_fn.regions.add = function (regions) {
        var $$ = this.internal, config = $$.config;
        if (!regions) { return config.regions; }
        config.regions = config.regions.concat(regions);
        $$.redrawWithoutRescale();
        return config.regions;
    };
    c3_chart_fn.regions.remove = function (options) {
        var $$ = this.internal, config = $$.config,
            duration, classes, regions;

        options = options || {};
        duration = $$.getOption(options, "duration", config.transition_duration);
        classes = $$.getOption(options, "classes", [CLASS.region]);

        regions = $$.main.select('.' + CLASS.regions).selectAll(classes.map(function (c) { return '.' + c; }));
        (duration ? regions.transition().duration(duration) : regions)
            .style('opacity', 0)
            .remove();

        config.regions = config.regions.filter(function (region) {
            var found = false;
            if (!region['class']) {
                return true;
            }
            region['class'].split(' ').forEach(function (c) {
                if (classes.indexOf(c) >= 0) { found = true; }
            });
            return !found;
        });

        return config.regions;
    };

    c3_chart_fn.data = function (targetIds) {
        var targets = this.internal.data.targets;
        return typeof targetIds === 'undefined' ? targets : targets.filter(function (t) {
            return [].concat(targetIds).indexOf(t.id) >= 0;
        });
    };
    c3_chart_fn.data.shown = function (targetIds) {
        return this.internal.filterTargetsToShow(this.data(targetIds));
    };
    c3_chart_fn.data.values = function (targetId) {
        var targets, values = null;
        if (targetId) {
            targets = this.data(targetId);
            values = targets[0] ? targets[0].values.map(function (d) { return d.value; }) : null;
        }
        return values;
    };
    c3_chart_fn.data.names = function (names) {
        this.internal.clearLegendItemTextBoxCache();
        return this.internal.updateDataAttributes('names', names);
    };
    c3_chart_fn.data.colors = function (colors) {
        return this.internal.updateDataAttributes('colors', colors);
    };
    c3_chart_fn.data.axes = function (axes) {
        return this.internal.updateDataAttributes('axes', axes);
    };

    c3_chart_fn.category = function (i, category) {
        var $$ = this.internal, config = $$.config;
        if (arguments.length > 1) {
            config.axis_x_categories[i] = category;
            $$.redraw();
        }
        return config.axis_x_categories[i];
    };
    c3_chart_fn.categories = function (categories) {
        var $$ = this.internal, config = $$.config;
        if (!arguments.length) { return config.axis_x_categories; }
        config.axis_x_categories = categories;
        $$.redraw();
        return config.axis_x_categories;
    };

    // TODO: fix
    c3_chart_fn.color = function (id) {
        var $$ = this.internal;
        return $$.color(id); // more patterns
    };

    c3_chart_fn.x = function (x) {
        var $$ = this.internal;
        if (arguments.length) {
            $$.updateTargetX($$.data.targets, x);
            $$.redraw({withUpdateOrgXDomain: true, withUpdateXDomain: true});
        }
        return $$.data.xs;
    };
    c3_chart_fn.xs = function (xs) {
        var $$ = this.internal;
        if (arguments.length) {
            $$.updateTargetXs($$.data.targets, xs);
            $$.redraw({withUpdateOrgXDomain: true, withUpdateXDomain: true});
        }
        return $$.data.xs;
    };

    c3_chart_fn.axis = function () {};
    c3_chart_fn.axis.labels = function (labels) {
        var $$ = this.internal;
        if (arguments.length) {
            Object.keys(labels).forEach(function (axisId) {
                $$.axis.setLabelText(axisId, labels[axisId]);
            });
            $$.axis.updateLabels();
        }
        // TODO: return some values?
    };
    c3_chart_fn.axis.max = function (max) {
        var $$ = this.internal, config = $$.config;
        if (arguments.length) {
            if (typeof max === 'object') {
                if (isValue(max.x)) { config.axis_x_max = max.x; }
                if (isValue(max.y)) { config.axis_y_max = max.y; }
                if (isValue(max.y2)) { config.axis_y2_max = max.y2; }
            } else {
                config.axis_y_max = config.axis_y2_max = max;
            }
            $$.redraw({withUpdateOrgXDomain: true, withUpdateXDomain: true});
        } else {
            return {
                x: config.axis_x_max,
                y: config.axis_y_max,
                y2: config.axis_y2_max
            };
        }
    };
    c3_chart_fn.axis.min = function (min) {
        var $$ = this.internal, config = $$.config;
        if (arguments.length) {
            if (typeof min === 'object') {
                if (isValue(min.x)) { config.axis_x_min = min.x; }
                if (isValue(min.y)) { config.axis_y_min = min.y; }
                if (isValue(min.y2)) { config.axis_y2_min = min.y2; }
            } else {
                config.axis_y_min = config.axis_y2_min = min;
            }
            $$.redraw({withUpdateOrgXDomain: true, withUpdateXDomain: true});
        } else {
            return {
                x: config.axis_x_min,
                y: config.axis_y_min,
                y2: config.axis_y2_min
            };
        }
    };
    c3_chart_fn.axis.range = function (range) {
        if (arguments.length) {
            if (isDefined(range.max)) { this.axis.max(range.max); }
            if (isDefined(range.min)) { this.axis.min(range.min); }
        } else {
            return {
                max: this.axis.max(),
                min: this.axis.min()
            };
        }
    };

    c3_chart_fn.legend = function () {};
    c3_chart_fn.legend.show = function (targetIds) {
        var $$ = this.internal;
        $$.showLegend($$.mapToTargetIds(targetIds));
        $$.updateAndRedraw({withLegend: true});
    };
    c3_chart_fn.legend.hide = function (targetIds) {
        var $$ = this.internal;
        $$.hideLegend($$.mapToTargetIds(targetIds));
        $$.updateAndRedraw({withLegend: true});
    };

    c3_chart_fn.resize = function (size) {
        var $$ = this.internal, config = $$.config;
        config.size_width = size ? size.width : null;
        config.size_height = size ? size.height : null;
        this.flush();
    };

    c3_chart_fn.flush = function () {
        var $$ = this.internal;
        $$.updateAndRedraw({withLegend: true, withTransition: false, withTransitionForTransform: false});
    };

    c3_chart_fn.destroy = function () {
        var $$ = this.internal;

        window.clearInterval($$.intervalForObserveInserted);

        if ($$.resizeTimeout !== undefined) {
            window.clearTimeout($$.resizeTimeout);
        }

        if (window.detachEvent) {
            window.detachEvent('onresize', $$.resizeFunction);
        } else if (window.removeEventListener) {
            window.removeEventListener('resize', $$.resizeFunction);
        } else {
            var wrapper = window.onresize;
            // check if no one else removed our wrapper and remove our resizeFunction from it
            if (wrapper && wrapper.add && wrapper.remove) {
                wrapper.remove($$.resizeFunction);
            }
        }

        $$.selectChart.classed('c3', false).html("");

        // MEMO: this is needed because the reference of some elements will not be released, then memory leak will happen.
        Object.keys($$).forEach(function (key) {
            $$[key] = null;
        });

        return null;
    };

    c3_chart_fn.tooltip = function () {};
    c3_chart_fn.tooltip.show = function (args) {
        var $$ = this.internal, index, mouse;

        // determine mouse position on the chart
        if (args.mouse) {
            mouse = args.mouse;
        }

        // determine focus data
        if (args.data) {
            if ($$.isMultipleX()) {
                // if multiple xs, target point will be determined by mouse
                mouse = [$$.x(args.data.x), $$.getYScale(args.data.id)(args.data.value)];
                index = null;
            } else {
                // TODO: when tooltip_grouped = false
                index = isValue(args.data.index) ? args.data.index : $$.getIndexByX(args.data.x);
            }
        }
        else if (typeof args.x !== 'undefined') {
            index = $$.getIndexByX(args.x);
        }
        else if (typeof args.index !== 'undefined') {
            index = args.index;
        }

        // emulate mouse events to show
        $$.dispatchEvent('mouseover', index, mouse);
        $$.dispatchEvent('mousemove', index, mouse);

        $$.config.tooltip_onshow.call($$, args.data);
    };
    c3_chart_fn.tooltip.hide = function () {
        // TODO: get target data by checking the state of focus
        this.internal.dispatchEvent('mouseout', 0);

        this.internal.config.tooltip_onhide.call(this);
    };

    // Features:
    // 1. category axis
    // 2. ceil values of translate/x/y to int for half pixel antialiasing
    // 3. multiline tick text
    var tickTextCharSize;
    function c3_axis(d3, params) {
        var scale = d3.scale.linear(), orient = "bottom", innerTickSize = 6, outerTickSize, tickPadding = 3, tickValues = null, tickFormat, tickArguments;

        var tickOffset = 0, tickCulling = true, tickCentered;

        params = params || {};
        outerTickSize = params.withOuterTick ? 6 : 0;

        function axisX(selection, x) {
            selection.attr("transform", function (d) {
                return "translate(" + Math.ceil(x(d) + tickOffset) + ", 0)";
            });
        }
        function axisY(selection, y) {
            selection.attr("transform", function (d) {
                return "translate(0," + Math.ceil(y(d)) + ")";
            });
        }
        function scaleExtent(domain) {
            var start = domain[0], stop = domain[domain.length - 1];
            return start < stop ? [ start, stop ] : [ stop, start ];
        }
        function generateTicks(scale) {
            var i, domain, ticks = [];
            if (scale.ticks) {
                return scale.ticks.apply(scale, tickArguments);
            }
            domain = scale.domain();
            for (i = Math.ceil(domain[0]); i < domain[1]; i++) {
                ticks.push(i);
            }
            if (ticks.length > 0 && ticks[0] > 0) {
                ticks.unshift(ticks[0] - (ticks[1] - ticks[0]));
            }
            return ticks;
        }
        function copyScale() {
            var newScale = scale.copy(), domain;
            if (params.isCategory) {
                domain = scale.domain();
                newScale.domain([domain[0], domain[1] - 1]);
            }
            return newScale;
        }
        function textFormatted(v) {
            var formatted = tickFormat ? tickFormat(v) : v;
            return typeof formatted !== 'undefined' ? formatted : '';
        }
        function getSizeFor1Char(tick) {
            if (tickTextCharSize) {
                return tickTextCharSize;
            }
            var size = {
                h: 11.5,
                w: 5.5
            };
            tick.select('text').text(textFormatted).each(function (d) {
                var box = this.getBoundingClientRect(),
                    text = textFormatted(d),
                    h = box.height,
                    w = text ? (box.width / text.length) : undefined;
                if (h && w) {
                    size.h = h;
                    size.w = w;
                }
            }).text('');
            tickTextCharSize = size;
            return size;
        }
        function transitionise(selection) {
            return params.withoutTransition ? selection : d3.transition(selection);
        }
        function axis(g) {
            g.each(function () {
                var g = axis.g = d3.select(this);

                var scale0 = this.__chart__ || scale, scale1 = this.__chart__ = copyScale();

                var ticks = tickValues ? tickValues : generateTicks(scale1),
                    tick = g.selectAll(".tick").data(ticks, scale1),
                    tickEnter = tick.enter().insert("g", ".domain").attr("class", "tick").style("opacity", 1e-6),
                    // MEMO: No exit transition. The reason is this transition affects max tick width calculation because old tick will be included in the ticks.
                    tickExit = tick.exit().remove(),
                    tickUpdate = transitionise(tick).style("opacity", 1),
                    tickTransform, tickX, tickY;

                var range = scale.rangeExtent ? scale.rangeExtent() : scaleExtent(scale.range()),
                    path = g.selectAll(".domain").data([ 0 ]),
                    pathUpdate = (path.enter().append("path").attr("class", "domain"), transitionise(path));
                tickEnter.append("line");
                tickEnter.append("text");

                var lineEnter = tickEnter.select("line"),
                    lineUpdate = tickUpdate.select("line"),
                    textEnter = tickEnter.select("text"),
                    textUpdate = tickUpdate.select("text");

                if (params.isCategory) {
                    tickOffset = Math.ceil((scale1(1) - scale1(0)) / 2);
                    tickX = tickCentered ? 0 : tickOffset;
                    tickY = tickCentered ? tickOffset : 0;
                } else {
                    tickOffset = tickX = 0;
                }

                var text, tspan, sizeFor1Char = getSizeFor1Char(g.select('.tick')), counts = [];
                var tickLength = Math.max(innerTickSize, 0) + tickPadding,
                    isVertical = orient === 'left' || orient === 'right';

                // this should be called only when category axis
                function splitTickText(d, maxWidth) {
                    var tickText = textFormatted(d),
                        subtext, spaceIndex, textWidth, splitted = [];

                    if (Object.prototype.toString.call(tickText) === "[object Array]") {
                        return tickText;
                    }

                    if (!maxWidth || maxWidth <= 0) {
                        maxWidth = isVertical ? 95 : params.isCategory ? (Math.ceil(scale1(ticks[1]) - scale1(ticks[0])) - 12) + params.tickMultilineOffset : 110;
                    }
                    function split(splitted, text) {
                        spaceIndex = undefined;
                        for (var i = 1; i < text.length; i++) {
                            if (text.charAt(i) === ' ') {
                                spaceIndex = i;
                            }
                            subtext = text.substr(0, i + 1);
                            textWidth = sizeFor1Char.w * subtext.length;
                            // if text width gets over tick width, split by space index or crrent index
                            if (maxWidth < textWidth) {
                                return split(
                                    splitted.concat(text.substr(0, spaceIndex ? spaceIndex : i)),
                                    text.slice(spaceIndex ? spaceIndex + 1 : i)
                                );
                            }
                        }
                        return splitted.concat(text);
                    }

                    return split(splitted, tickText + "");
                }

                function tspanDy(d, i) {
                    var dy = sizeFor1Char.h;
                    if (i === 0) {
                        if (orient === 'left' || orient === 'right') {
                            dy = -((counts[d.index] - 1) * (sizeFor1Char.h / 2) - 3);
                        } else {
                            dy = ".71em";
                        }
                    }
                    return dy;
                }

                function tickSize(d) {
                    var tickPosition = scale(d) + (tickCentered ? 0 : tickOffset);
                    return range[0] < tickPosition && tickPosition < range[1] ? innerTickSize : 0;
                }

                text = tick.select("text");
                tspan = text.selectAll('tspan')
                    .data(function (d, i) {
                        var splitted = params.tickMultiline ? splitTickText(d, params.tickWidth) : [].concat(textFormatted(d));
                        counts[i] = splitted.length;
                        return splitted.map(function (s) {
                            return { index: i, splitted: s };
                        });
                    });
                tspan.enter().append('tspan');
                tspan.exit().remove();
                tspan.text(function (d) { return d.splitted; });

                var rotate = params.tickTextRotate;

                function textAnchorForText(rotate) {
                    if (!rotate) {
                        return 'middle';
                    }
                    return rotate > 0 ? "start" : "end";
                }
                function textTransform(rotate) {
                    if (!rotate) {
                        return '';
                    }
                    return "rotate(" + rotate + ")";
                }
                function dxForText(rotate) {
                    if (!rotate) {
                        return 0;
                    }
                    return 8 * Math.sin(Math.PI * (rotate / 180));
                }
                function yForText(rotate) {
                    if (!rotate) {
                        return tickLength;
                    }
                    return 11.5 - 2.5 * (rotate / 15) * (rotate > 0 ? 1 : -1);
                }

                switch (orient) {
                case "bottom":
                    {
                        tickTransform = axisX;
                        lineEnter.attr("y2", innerTickSize);
                        textEnter.attr("y", tickLength);
                        lineUpdate.attr("x1", tickX).attr("x2", tickX).attr("y2", tickSize);
                        textUpdate.attr("x", 0).attr("y", yForText(rotate))
                            .style("text-anchor", textAnchorForText(rotate))
                            .attr("transform", textTransform(rotate));
                        tspan.attr('x', 0).attr("dy", tspanDy).attr('dx', dxForText(rotate));
                        pathUpdate.attr("d", "M" + range[0] + "," + outerTickSize + "V0H" + range[1] + "V" + outerTickSize);
                        break;
                    }
                case "top":
                    {
                        // TODO: rotated tick text
                        tickTransform = axisX;
                        lineEnter.attr("y2", -innerTickSize);
                        textEnter.attr("y", -tickLength);
                        lineUpdate.attr("x2", 0).attr("y2", -innerTickSize);
                        textUpdate.attr("x", 0).attr("y", -tickLength);
                        text.style("text-anchor", "middle");
                        tspan.attr('x', 0).attr("dy", "0em");
                        pathUpdate.attr("d", "M" + range[0] + "," + -outerTickSize + "V0H" + range[1] + "V" + -outerTickSize);
                        break;
                    }
                case "left":
                    {
                        tickTransform = axisY;
                        lineEnter.attr("x2", -innerTickSize);
                        textEnter.attr("x", -tickLength);
                        lineUpdate.attr("x2", -innerTickSize).attr("y1", tickY).attr("y2", tickY);
                        textUpdate.attr("x", -tickLength).attr("y", tickOffset);
                        text.style("text-anchor", "end");
                        tspan.attr('x', -tickLength).attr("dy", tspanDy);
                        pathUpdate.attr("d", "M" + -outerTickSize + "," + range[0] + "H0V" + range[1] + "H" + -outerTickSize);
                        break;
                    }
                case "right":
                    {
                        tickTransform = axisY;
                        lineEnter.attr("x2", innerTickSize);
                        textEnter.attr("x", tickLength);
                        lineUpdate.attr("x2", innerTickSize).attr("y2", 0);
                        textUpdate.attr("x", tickLength).attr("y", 0);
                        text.style("text-anchor", "start");
                        tspan.attr('x', tickLength).attr("dy", tspanDy);
                        pathUpdate.attr("d", "M" + outerTickSize + "," + range[0] + "H0V" + range[1] + "H" + outerTickSize);
                        break;
                    }
                }
                if (scale1.rangeBand) {
                    var x = scale1, dx = x.rangeBand() / 2;
                    scale0 = scale1 = function (d) {
                        return x(d) + dx;
                    };
                } else if (scale0.rangeBand) {
                    scale0 = scale1;
                } else {
                    tickExit.call(tickTransform, scale1);
                }
                tickEnter.call(tickTransform, scale0);
                tickUpdate.call(tickTransform, scale1);
            });
        }
        axis.scale = function (x) {
            if (!arguments.length) { return scale; }
            scale = x;
            return axis;
        };
        axis.orient = function (x) {
            if (!arguments.length) { return orient; }
            orient = x in {top: 1, right: 1, bottom: 1, left: 1} ? x + "" : "bottom";
            return axis;
        };
        axis.tickFormat = function (format) {
            if (!arguments.length) { return tickFormat; }
            tickFormat = format;
            return axis;
        };
        axis.tickCentered = function (isCentered) {
            if (!arguments.length) { return tickCentered; }
            tickCentered = isCentered;
            return axis;
        };
        axis.tickOffset = function () {
            return tickOffset;
        };
        axis.tickInterval = function () {
            var interval, length;
            if (params.isCategory) {
                interval = tickOffset * 2;
            }
            else {
                length = axis.g.select('path.domain').node().getTotalLength() - outerTickSize * 2;
                interval = length / axis.g.selectAll('line').size();
            }
            return interval === Infinity ? 0 : interval;
        };
        axis.ticks = function () {
            if (!arguments.length) { return tickArguments; }
            tickArguments = arguments;
            return axis;
        };
        axis.tickCulling = function (culling) {
            if (!arguments.length) { return tickCulling; }
            tickCulling = culling;
            return axis;
        };
        axis.tickValues = function (x) {
            if (typeof x === 'function') {
                tickValues = function () {
                    return x(scale.domain());
                };
            }
            else {
                if (!arguments.length) { return tickValues; }
                tickValues = x;
            }
            return axis;
        };
        return axis;
    }

    c3_chart_internal_fn.isSafari = function () {
        var ua = window.navigator.userAgent;
        return ua.indexOf('Safari') >= 0 && ua.indexOf('Chrome') < 0;
    };
    c3_chart_internal_fn.isChrome = function () {
        var ua = window.navigator.userAgent;
        return ua.indexOf('Chrome') >= 0;
    };

    /* jshint ignore:start */

    // PhantomJS doesn't have support for Function.prototype.bind, which has caused confusion. Use
    // this polyfill to avoid the confusion.
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function/bind#Polyfill

    if (!Function.prototype.bind) {
      Function.prototype.bind = function(oThis) {
        if (typeof this !== 'function') {
          // closest thing possible to the ECMAScript 5
          // internal IsCallable function
          throw new TypeError('Function.prototype.bind - what is trying to be bound is not callable');
        }

        var aArgs   = Array.prototype.slice.call(arguments, 1),
            fToBind = this,
            fNOP    = function() {},
            fBound  = function() {
              return fToBind.apply(this instanceof fNOP ? this : oThis, aArgs.concat(Array.prototype.slice.call(arguments)));
            };

        fNOP.prototype = this.prototype;
        fBound.prototype = new fNOP();

        return fBound;
      };
    }

    //SVGPathSeg API polyfill
    //https://github.com/progers/pathseg
    //
    //This is a drop-in replacement for the SVGPathSeg and SVGPathSegList APIs that were removed from
    //SVG2 (https://lists.w3.org/Archives/Public/www-svg/2015Jun/0044.html), including the latest spec
    //changes which were implemented in Firefox 43 and Chrome 46.
    //Chrome 48 removes these APIs, so this polyfill is required.

    (function() { "use strict";
     if (!("SVGPathSeg" in window)) {
         // Spec: http://www.w3.org/TR/SVG11/single-page.html#paths-InterfaceSVGPathSeg
         window.SVGPathSeg = function(type, typeAsLetter, owningPathSegList) {
             this.pathSegType = type;
             this.pathSegTypeAsLetter = typeAsLetter;
             this._owningPathSegList = owningPathSegList;
         }

         SVGPathSeg.PATHSEG_UNKNOWN = 0;
         SVGPathSeg.PATHSEG_CLOSEPATH = 1;
         SVGPathSeg.PATHSEG_MOVETO_ABS = 2;
         SVGPathSeg.PATHSEG_MOVETO_REL = 3;
         SVGPathSeg.PATHSEG_LINETO_ABS = 4;
         SVGPathSeg.PATHSEG_LINETO_REL = 5;
         SVGPathSeg.PATHSEG_CURVETO_CUBIC_ABS = 6;
         SVGPathSeg.PATHSEG_CURVETO_CUBIC_REL = 7;
         SVGPathSeg.PATHSEG_CURVETO_QUADRATIC_ABS = 8;
         SVGPathSeg.PATHSEG_CURVETO_QUADRATIC_REL = 9;
         SVGPathSeg.PATHSEG_ARC_ABS = 10;
         SVGPathSeg.PATHSEG_ARC_REL = 11;
         SVGPathSeg.PATHSEG_LINETO_HORIZONTAL_ABS = 12;
         SVGPathSeg.PATHSEG_LINETO_HORIZONTAL_REL = 13;
         SVGPathSeg.PATHSEG_LINETO_VERTICAL_ABS = 14;
         SVGPathSeg.PATHSEG_LINETO_VERTICAL_REL = 15;
         SVGPathSeg.PATHSEG_CURVETO_CUBIC_SMOOTH_ABS = 16;
         SVGPathSeg.PATHSEG_CURVETO_CUBIC_SMOOTH_REL = 17;
         SVGPathSeg.PATHSEG_CURVETO_QUADRATIC_SMOOTH_ABS = 18;
         SVGPathSeg.PATHSEG_CURVETO_QUADRATIC_SMOOTH_REL = 19;

         // Notify owning PathSegList on any changes so they can be synchronized back to the path element.
         SVGPathSeg.prototype._segmentChanged = function() {
             if (this._owningPathSegList)
                 this._owningPathSegList.segmentChanged(this);
         }

         window.SVGPathSegClosePath = function(owningPathSegList) {
             SVGPathSeg.call(this, SVGPathSeg.PATHSEG_CLOSEPATH, "z", owningPathSegList);
         }
         SVGPathSegClosePath.prototype = Object.create(SVGPathSeg.prototype);
         SVGPathSegClosePath.prototype.toString = function() { return "[object SVGPathSegClosePath]"; }
         SVGPathSegClosePath.prototype._asPathString = function() { return this.pathSegTypeAsLetter; }
         SVGPathSegClosePath.prototype.clone = function() { return new SVGPathSegClosePath(undefined); }

         window.SVGPathSegMovetoAbs = function(owningPathSegList, x, y) {
             SVGPathSeg.call(this, SVGPathSeg.PATHSEG_MOVETO_ABS, "M", owningPathSegList);
             this._x = x;
             this._y = y;
         }
         SVGPathSegMovetoAbs.prototype = Object.create(SVGPathSeg.prototype);
         SVGPathSegMovetoAbs.prototype.toString = function() { return "[object SVGPathSegMovetoAbs]"; }
         SVGPathSegMovetoAbs.prototype._asPathString = function() { return this.pathSegTypeAsLetter + " " + this._x + " " + this._y; }
         SVGPathSegMovetoAbs.prototype.clone = function() { return new SVGPathSegMovetoAbs(undefined, this._x, this._y); }
         Object.defineProperty(SVGPathSegMovetoAbs.prototype, "x", { get: function() { return this._x; }, set: function(x) { this._x = x; this._segmentChanged(); }, enumerable: true });
         Object.defineProperty(SVGPathSegMovetoAbs.prototype, "y", { get: function() { return this._y; }, set: function(y) { this._y = y; this._segmentChanged(); }, enumerable: true });

         window.SVGPathSegMovetoRel = function(owningPathSegList, x, y) {
             SVGPathSeg.call(this, SVGPathSeg.PATHSEG_MOVETO_REL, "m", owningPathSegList);
             this._x = x;
             this._y = y;
         }
         SVGPathSegMovetoRel.prototype = Object.create(SVGPathSeg.prototype);
         SVGPathSegMovetoRel.prototype.toString = function() { return "[object SVGPathSegMovetoRel]"; }
         SVGPathSegMovetoRel.prototype._asPathString = function() { return this.pathSegTypeAsLetter + " " + this._x + " " + this._y; }
         SVGPathSegMovetoRel.prototype.clone = function() { return new SVGPathSegMovetoRel(undefined, this._x, this._y); }
         Object.defineProperty(SVGPathSegMovetoRel.prototype, "x", { get: function() { return this._x; }, set: function(x) { this._x = x; this._segmentChanged(); }, enumerable: true });
         Object.defineProperty(SVGPathSegMovetoRel.prototype, "y", { get: function() { return this._y; }, set: function(y) { this._y = y; this._segmentChanged(); }, enumerable: true });

         window.SVGPathSegLinetoAbs = function(owningPathSegList, x, y) {
             SVGPathSeg.call(this, SVGPathSeg.PATHSEG_LINETO_ABS, "L", owningPathSegList);
             this._x = x;
             this._y = y;
         }
         SVGPathSegLinetoAbs.prototype = Object.create(SVGPathSeg.prototype);
         SVGPathSegLinetoAbs.prototype.toString = function() { return "[object SVGPathSegLinetoAbs]"; }
         SVGPathSegLinetoAbs.prototype._asPathString = function() { return this.pathSegTypeAsLetter + " " + this._x + " " + this._y; }
         SVGPathSegLinetoAbs.prototype.clone = function() { return new SVGPathSegLinetoAbs(undefined, this._x, this._y); }
         Object.defineProperty(SVGPathSegLinetoAbs.prototype, "x", { get: function() { return this._x; }, set: function(x) { this._x = x; this._segmentChanged(); }, enumerable: true });
         Object.defineProperty(SVGPathSegLinetoAbs.prototype, "y", { get: function() { return this._y; }, set: function(y) { this._y = y; this._segmentChanged(); }, enumerable: true });

         window.SVGPathSegLinetoRel = function(owningPathSegList, x, y) {
             SVGPathSeg.call(this, SVGPathSeg.PATHSEG_LINETO_REL, "l", owningPathSegList);
             this._x = x;
             this._y = y;
         }
         SVGPathSegLinetoRel.prototype = Object.create(SVGPathSeg.prototype);
         SVGPathSegLinetoRel.prototype.toString = function() { return "[object SVGPathSegLinetoRel]"; }
         SVGPathSegLinetoRel.prototype._asPathString = function() { return this.pathSegTypeAsLetter + " " + this._x + " " + this._y; }
         SVGPathSegLinetoRel.prototype.clone = function() { return new SVGPathSegLinetoRel(undefined, this._x, this._y); }
         Object.defineProperty(SVGPathSegLinetoRel.prototype, "x", { get: function() { return this._x; }, set: function(x) { this._x = x; this._segmentChanged(); }, enumerable: true });
         Object.defineProperty(SVGPathSegLinetoRel.prototype, "y", { get: function() { return this._y; }, set: function(y) { this._y = y; this._segmentChanged(); }, enumerable: true });

         window.SVGPathSegCurvetoCubicAbs = function(owningPathSegList, x, y, x1, y1, x2, y2) {
             SVGPathSeg.call(this, SVGPathSeg.PATHSEG_CURVETO_CUBIC_ABS, "C", owningPathSegList);
             this._x = x;
             this._y = y;
             this._x1 = x1;
             this._y1 = y1;
             this._x2 = x2;
             this._y2 = y2;
         }
         SVGPathSegCurvetoCubicAbs.prototype = Object.create(SVGPathSeg.prototype);
         SVGPathSegCurvetoCubicAbs.prototype.toString = function() { return "[object SVGPathSegCurvetoCubicAbs]"; }
         SVGPathSegCurvetoCubicAbs.prototype._asPathString = function() { return this.pathSegTypeAsLetter + " " + this._x1 + " " + this._y1 + " " + this._x2 + " " + this._y2 + " " + this._x + " " + this._y; }
         SVGPathSegCurvetoCubicAbs.prototype.clone = function() { return new SVGPathSegCurvetoCubicAbs(undefined, this._x, this._y, this._x1, this._y1, this._x2, this._y2); }
         Object.defineProperty(SVGPathSegCurvetoCubicAbs.prototype, "x", { get: function() { return this._x; }, set: function(x) { this._x = x; this._segmentChanged(); }, enumerable: true });
         Object.defineProperty(SVGPathSegCurvetoCubicAbs.prototype, "y", { get: function() { return this._y; }, set: function(y) { this._y = y; this._segmentChanged(); }, enumerable: true });
         Object.defineProperty(SVGPathSegCurvetoCubicAbs.prototype, "x1", { get: function() { return this._x1; }, set: function(x1) { this._x1 = x1; this._segmentChanged(); }, enumerable: true });
         Object.defineProperty(SVGPathSegCurvetoCubicAbs.prototype, "y1", { get: function() { return this._y1; }, set: function(y1) { this._y1 = y1; this._segmentChanged(); }, enumerable: true });
         Object.defineProperty(SVGPathSegCurvetoCubicAbs.prototype, "x2", { get: function() { return this._x2; }, set: function(x2) { this._x2 = x2; this._segmentChanged(); }, enumerable: true });
         Object.defineProperty(SVGPathSegCurvetoCubicAbs.prototype, "y2", { get: function() { return this._y2; }, set: function(y2) { this._y2 = y2; this._segmentChanged(); }, enumerable: true });

         window.SVGPathSegCurvetoCubicRel = function(owningPathSegList, x, y, x1, y1, x2, y2) {
             SVGPathSeg.call(this, SVGPathSeg.PATHSEG_CURVETO_CUBIC_REL, "c", owningPathSegList);
             this._x = x;
             this._y = y;
             this._x1 = x1;
             this._y1 = y1;
             this._x2 = x2;
             this._y2 = y2;
         }
         SVGPathSegCurvetoCubicRel.prototype = Object.create(SVGPathSeg.prototype);
         SVGPathSegCurvetoCubicRel.prototype.toString = function() { return "[object SVGPathSegCurvetoCubicRel]"; }
         SVGPathSegCurvetoCubicRel.prototype._asPathString = function() { return this.pathSegTypeAsLetter + " " + this._x1 + " " + this._y1 + " " + this._x2 + " " + this._y2 + " " + this._x + " " + this._y; }
         SVGPathSegCurvetoCubicRel.prototype.clone = function() { return new SVGPathSegCurvetoCubicRel(undefined, this._x, this._y, this._x1, this._y1, this._x2, this._y2); }
         Object.defineProperty(SVGPathSegCurvetoCubicRel.prototype, "x", { get: function() { return this._x; }, set: function(x) { this._x = x; this._segmentChanged(); }, enumerable: true });
         Object.defineProperty(SVGPathSegCurvetoCubicRel.prototype, "y", { get: function() { return this._y; }, set: function(y) { this._y = y; this._segmentChanged(); }, enumerable: true });
         Object.defineProperty(SVGPathSegCurvetoCubicRel.prototype, "x1", { get: function() { return this._x1; }, set: function(x1) { this._x1 = x1; this._segmentChanged(); }, enumerable: true });
         Object.defineProperty(SVGPathSegCurvetoCubicRel.prototype, "y1", { get: function() { return this._y1; }, set: function(y1) { this._y1 = y1; this._segmentChanged(); }, enumerable: true });
         Object.defineProperty(SVGPathSegCurvetoCubicRel.prototype, "x2", { get: function() { return this._x2; }, set: function(x2) { this._x2 = x2; this._segmentChanged(); }, enumerable: true });
         Object.defineProperty(SVGPathSegCurvetoCubicRel.prototype, "y2", { get: function() { return this._y2; }, set: function(y2) { this._y2 = y2; this._segmentChanged(); }, enumerable: true });

         window.SVGPathSegCurvetoQuadraticAbs = function(owningPathSegList, x, y, x1, y1) {
             SVGPathSeg.call(this, SVGPathSeg.PATHSEG_CURVETO_QUADRATIC_ABS, "Q", owningPathSegList);
             this._x = x;
             this._y = y;
             this._x1 = x1;
             this._y1 = y1;
         }
         SVGPathSegCurvetoQuadraticAbs.prototype = Object.create(SVGPathSeg.prototype);
         SVGPathSegCurvetoQuadraticAbs.prototype.toString = function() { return "[object SVGPathSegCurvetoQuadraticAbs]"; }
         SVGPathSegCurvetoQuadraticAbs.prototype._asPathString = function() { return this.pathSegTypeAsLetter + " " + this._x1 + " " + this._y1 + " " + this._x + " " + this._y; }
         SVGPathSegCurvetoQuadraticAbs.prototype.clone = function() { return new SVGPathSegCurvetoQuadraticAbs(undefined, this._x, this._y, this._x1, this._y1); }
         Object.defineProperty(SVGPathSegCurvetoQuadraticAbs.prototype, "x", { get: function() { return this._x; }, set: function(x) { this._x = x; this._segmentChanged(); }, enumerable: true });
         Object.defineProperty(SVGPathSegCurvetoQuadraticAbs.prototype, "y", { get: function() { return this._y; }, set: function(y) { this._y = y; this._segmentChanged(); }, enumerable: true });
         Object.defineProperty(SVGPathSegCurvetoQuadraticAbs.prototype, "x1", { get: function() { return this._x1; }, set: function(x1) { this._x1 = x1; this._segmentChanged(); }, enumerable: true });
         Object.defineProperty(SVGPathSegCurvetoQuadraticAbs.prototype, "y1", { get: function() { return this._y1; }, set: function(y1) { this._y1 = y1; this._segmentChanged(); }, enumerable: true });

         window.SVGPathSegCurvetoQuadraticRel = function(owningPathSegList, x, y, x1, y1) {
             SVGPathSeg.call(this, SVGPathSeg.PATHSEG_CURVETO_QUADRATIC_REL, "q", owningPathSegList);
             this._x = x;
             this._y = y;
             this._x1 = x1;
             this._y1 = y1;
         }
         SVGPathSegCurvetoQuadraticRel.prototype = Object.create(SVGPathSeg.prototype);
         SVGPathSegCurvetoQuadraticRel.prototype.toString = function() { return "[object SVGPathSegCurvetoQuadraticRel]"; }
         SVGPathSegCurvetoQuadraticRel.prototype._asPathString = function() { return this.pathSegTypeAsLetter + " " + this._x1 + " " + this._y1 + " " + this._x + " " + this._y; }
         SVGPathSegCurvetoQuadraticRel.prototype.clone = function() { return new SVGPathSegCurvetoQuadraticRel(undefined, this._x, this._y, this._x1, this._y1); }
         Object.defineProperty(SVGPathSegCurvetoQuadraticRel.prototype, "x", { get: function() { return this._x; }, set: function(x) { this._x = x; this._segmentChanged(); }, enumerable: true });
         Object.defineProperty(SVGPathSegCurvetoQuadraticRel.prototype, "y", { get: function() { return this._y; }, set: function(y) { this._y = y; this._segmentChanged(); }, enumerable: true });
         Object.defineProperty(SVGPathSegCurvetoQuadraticRel.prototype, "x1", { get: function() { return this._x1; }, set: function(x1) { this._x1 = x1; this._segmentChanged(); }, enumerable: true });
         Object.defineProperty(SVGPathSegCurvetoQuadraticRel.prototype, "y1", { get: function() { return this._y1; }, set: function(y1) { this._y1 = y1; this._segmentChanged(); }, enumerable: true });

         window.SVGPathSegArcAbs = function(owningPathSegList, x, y, r1, r2, angle, largeArcFlag, sweepFlag) {
             SVGPathSeg.call(this, SVGPathSeg.PATHSEG_ARC_ABS, "A", owningPathSegList);
             this._x = x;
             this._y = y;
             this._r1 = r1;
             this._r2 = r2;
             this._angle = angle;
             this._largeArcFlag = largeArcFlag;
             this._sweepFlag = sweepFlag;
         }
         SVGPathSegArcAbs.prototype = Object.create(SVGPathSeg.prototype);
         SVGPathSegArcAbs.prototype.toString = function() { return "[object SVGPathSegArcAbs]"; }
         SVGPathSegArcAbs.prototype._asPathString = function() { return this.pathSegTypeAsLetter + " " + this._r1 + " " + this._r2 + " " + this._angle + " " + (this._largeArcFlag ? "1" : "0") + " " + (this._sweepFlag ? "1" : "0") + " " + this._x + " " + this._y; }
         SVGPathSegArcAbs.prototype.clone = function() { return new SVGPathSegArcAbs(undefined, this._x, this._y, this._r1, this._r2, this._angle, this._largeArcFlag, this._sweepFlag); }
         Object.defineProperty(SVGPathSegArcAbs.prototype, "x", { get: function() { return this._x; }, set: function(x) { this._x = x; this._segmentChanged(); }, enumerable: true });
         Object.defineProperty(SVGPathSegArcAbs.prototype, "y", { get: function() { return this._y; }, set: function(y) { this._y = y; this._segmentChanged(); }, enumerable: true });
         Object.defineProperty(SVGPathSegArcAbs.prototype, "r1", { get: function() { return this._r1; }, set: function(r1) { this._r1 = r1; this._segmentChanged(); }, enumerable: true });
         Object.defineProperty(SVGPathSegArcAbs.prototype, "r2", { get: function() { return this._r2; }, set: function(r2) { this._r2 = r2; this._segmentChanged(); }, enumerable: true });
         Object.defineProperty(SVGPathSegArcAbs.prototype, "angle", { get: function() { return this._angle; }, set: function(angle) { this._angle = angle; this._segmentChanged(); }, enumerable: true });
         Object.defineProperty(SVGPathSegArcAbs.prototype, "largeArcFlag", { get: function() { return this._largeArcFlag; }, set: function(largeArcFlag) { this._largeArcFlag = largeArcFlag; this._segmentChanged(); }, enumerable: true });
         Object.defineProperty(SVGPathSegArcAbs.prototype, "sweepFlag", { get: function() { return this._sweepFlag; }, set: function(sweepFlag) { this._sweepFlag = sweepFlag; this._segmentChanged(); }, enumerable: true });

         window.SVGPathSegArcRel = function(owningPathSegList, x, y, r1, r2, angle, largeArcFlag, sweepFlag) {
             SVGPathSeg.call(this, SVGPathSeg.PATHSEG_ARC_REL, "a", owningPathSegList);
             this._x = x;
             this._y = y;
             this._r1 = r1;
             this._r2 = r2;
             this._angle = angle;
             this._largeArcFlag = largeArcFlag;
             this._sweepFlag = sweepFlag;
         }
         SVGPathSegArcRel.prototype = Object.create(SVGPathSeg.prototype);
         SVGPathSegArcRel.prototype.toString = function() { return "[object SVGPathSegArcRel]"; }
         SVGPathSegArcRel.prototype._asPathString = function() { return this.pathSegTypeAsLetter + " " + this._r1 + " " + this._r2 + " " + this._angle + " " + (this._largeArcFlag ? "1" : "0") + " " + (this._sweepFlag ? "1" : "0") + " " + this._x + " " + this._y; }
         SVGPathSegArcRel.prototype.clone = function() { return new SVGPathSegArcRel(undefined, this._x, this._y, this._r1, this._r2, this._angle, this._largeArcFlag, this._sweepFlag); }
         Object.defineProperty(SVGPathSegArcRel.prototype, "x", { get: function() { return this._x; }, set: function(x) { this._x = x; this._segmentChanged(); }, enumerable: true });
         Object.defineProperty(SVGPathSegArcRel.prototype, "y", { get: function() { return this._y; }, set: function(y) { this._y = y; this._segmentChanged(); }, enumerable: true });
         Object.defineProperty(SVGPathSegArcRel.prototype, "r1", { get: function() { return this._r1; }, set: function(r1) { this._r1 = r1; this._segmentChanged(); }, enumerable: true });
         Object.defineProperty(SVGPathSegArcRel.prototype, "r2", { get: function() { return this._r2; }, set: function(r2) { this._r2 = r2; this._segmentChanged(); }, enumerable: true });
         Object.defineProperty(SVGPathSegArcRel.prototype, "angle", { get: function() { return this._angle; }, set: function(angle) { this._angle = angle; this._segmentChanged(); }, enumerable: true });
         Object.defineProperty(SVGPathSegArcRel.prototype, "largeArcFlag", { get: function() { return this._largeArcFlag; }, set: function(largeArcFlag) { this._largeArcFlag = largeArcFlag; this._segmentChanged(); }, enumerable: true });
         Object.defineProperty(SVGPathSegArcRel.prototype, "sweepFlag", { get: function() { return this._sweepFlag; }, set: function(sweepFlag) { this._sweepFlag = sweepFlag; this._segmentChanged(); }, enumerable: true });

         window.SVGPathSegLinetoHorizontalAbs = function(owningPathSegList, x) {
             SVGPathSeg.call(this, SVGPathSeg.PATHSEG_LINETO_HORIZONTAL_ABS, "H", owningPathSegList);
             this._x = x;
         }
         SVGPathSegLinetoHorizontalAbs.prototype = Object.create(SVGPathSeg.prototype);
         SVGPathSegLinetoHorizontalAbs.prototype.toString = function() { return "[object SVGPathSegLinetoHorizontalAbs]"; }
         SVGPathSegLinetoHorizontalAbs.prototype._asPathString = function() { return this.pathSegTypeAsLetter + " " + this._x; }
         SVGPathSegLinetoHorizontalAbs.prototype.clone = function() { return new SVGPathSegLinetoHorizontalAbs(undefined, this._x); }
         Object.defineProperty(SVGPathSegLinetoHorizontalAbs.prototype, "x", { get: function() { return this._x; }, set: function(x) { this._x = x; this._segmentChanged(); }, enumerable: true });

         window.SVGPathSegLinetoHorizontalRel = function(owningPathSegList, x) {
             SVGPathSeg.call(this, SVGPathSeg.PATHSEG_LINETO_HORIZONTAL_REL, "h", owningPathSegList);
             this._x = x;
         }
         SVGPathSegLinetoHorizontalRel.prototype = Object.create(SVGPathSeg.prototype);
         SVGPathSegLinetoHorizontalRel.prototype.toString = function() { return "[object SVGPathSegLinetoHorizontalRel]"; }
         SVGPathSegLinetoHorizontalRel.prototype._asPathString = function() { return this.pathSegTypeAsLetter + " " + this._x; }
         SVGPathSegLinetoHorizontalRel.prototype.clone = function() { return new SVGPathSegLinetoHorizontalRel(undefined, this._x); }
         Object.defineProperty(SVGPathSegLinetoHorizontalRel.prototype, "x", { get: function() { return this._x; }, set: function(x) { this._x = x; this._segmentChanged(); }, enumerable: true });

         window.SVGPathSegLinetoVerticalAbs = function(owningPathSegList, y) {
             SVGPathSeg.call(this, SVGPathSeg.PATHSEG_LINETO_VERTICAL_ABS, "V", owningPathSegList);
             this._y = y;
         }
         SVGPathSegLinetoVerticalAbs.prototype = Object.create(SVGPathSeg.prototype);
         SVGPathSegLinetoVerticalAbs.prototype.toString = function() { return "[object SVGPathSegLinetoVerticalAbs]"; }
         SVGPathSegLinetoVerticalAbs.prototype._asPathString = function() { return this.pathSegTypeAsLetter + " " + this._y; }
         SVGPathSegLinetoVerticalAbs.prototype.clone = function() { return new SVGPathSegLinetoVerticalAbs(undefined, this._y); }
         Object.defineProperty(SVGPathSegLinetoVerticalAbs.prototype, "y", { get: function() { return this._y; }, set: function(y) { this._y = y; this._segmentChanged(); }, enumerable: true });

         window.SVGPathSegLinetoVerticalRel = function(owningPathSegList, y) {
             SVGPathSeg.call(this, SVGPathSeg.PATHSEG_LINETO_VERTICAL_REL, "v", owningPathSegList);
             this._y = y;
         }
         SVGPathSegLinetoVerticalRel.prototype = Object.create(SVGPathSeg.prototype);
         SVGPathSegLinetoVerticalRel.prototype.toString = function() { return "[object SVGPathSegLinetoVerticalRel]"; }
         SVGPathSegLinetoVerticalRel.prototype._asPathString = function() { return this.pathSegTypeAsLetter + " " + this._y; }
         SVGPathSegLinetoVerticalRel.prototype.clone = function() { return new SVGPathSegLinetoVerticalRel(undefined, this._y); }
         Object.defineProperty(SVGPathSegLinetoVerticalRel.prototype, "y", { get: function() { return this._y; }, set: function(y) { this._y = y; this._segmentChanged(); }, enumerable: true });

         window.SVGPathSegCurvetoCubicSmoothAbs = function(owningPathSegList, x, y, x2, y2) {
             SVGPathSeg.call(this, SVGPathSeg.PATHSEG_CURVETO_CUBIC_SMOOTH_ABS, "S", owningPathSegList);
             this._x = x;
             this._y = y;
             this._x2 = x2;
             this._y2 = y2;
         }
         SVGPathSegCurvetoCubicSmoothAbs.prototype = Object.create(SVGPathSeg.prototype);
         SVGPathSegCurvetoCubicSmoothAbs.prototype.toString = function() { return "[object SVGPathSegCurvetoCubicSmoothAbs]"; }
         SVGPathSegCurvetoCubicSmoothAbs.prototype._asPathString = function() { return this.pathSegTypeAsLetter + " " + this._x2 + " " + this._y2 + " " + this._x + " " + this._y; }
         SVGPathSegCurvetoCubicSmoothAbs.prototype.clone = function() { return new SVGPathSegCurvetoCubicSmoothAbs(undefined, this._x, this._y, this._x2, this._y2); }
         Object.defineProperty(SVGPathSegCurvetoCubicSmoothAbs.prototype, "x", { get: function() { return this._x; }, set: function(x) { this._x = x; this._segmentChanged(); }, enumerable: true });
         Object.defineProperty(SVGPathSegCurvetoCubicSmoothAbs.prototype, "y", { get: function() { return this._y; }, set: function(y) { this._y = y; this._segmentChanged(); }, enumerable: true });
         Object.defineProperty(SVGPathSegCurvetoCubicSmoothAbs.prototype, "x2", { get: function() { return this._x2; }, set: function(x2) { this._x2 = x2; this._segmentChanged(); }, enumerable: true });
         Object.defineProperty(SVGPathSegCurvetoCubicSmoothAbs.prototype, "y2", { get: function() { return this._y2; }, set: function(y2) { this._y2 = y2; this._segmentChanged(); }, enumerable: true });

         window.SVGPathSegCurvetoCubicSmoothRel = function(owningPathSegList, x, y, x2, y2) {
             SVGPathSeg.call(this, SVGPathSeg.PATHSEG_CURVETO_CUBIC_SMOOTH_REL, "s", owningPathSegList);
             this._x = x;
             this._y = y;
             this._x2 = x2;
             this._y2 = y2;
         }
         SVGPathSegCurvetoCubicSmoothRel.prototype = Object.create(SVGPathSeg.prototype);
         SVGPathSegCurvetoCubicSmoothRel.prototype.toString = function() { return "[object SVGPathSegCurvetoCubicSmoothRel]"; }
         SVGPathSegCurvetoCubicSmoothRel.prototype._asPathString = function() { return this.pathSegTypeAsLetter + " " + this._x2 + " " + this._y2 + " " + this._x + " " + this._y; }
         SVGPathSegCurvetoCubicSmoothRel.prototype.clone = function() { return new SVGPathSegCurvetoCubicSmoothRel(undefined, this._x, this._y, this._x2, this._y2); }
         Object.defineProperty(SVGPathSegCurvetoCubicSmoothRel.prototype, "x", { get: function() { return this._x; }, set: function(x) { this._x = x; this._segmentChanged(); }, enumerable: true });
         Object.defineProperty(SVGPathSegCurvetoCubicSmoothRel.prototype, "y", { get: function() { return this._y; }, set: function(y) { this._y = y; this._segmentChanged(); }, enumerable: true });
         Object.defineProperty(SVGPathSegCurvetoCubicSmoothRel.prototype, "x2", { get: function() { return this._x2; }, set: function(x2) { this._x2 = x2; this._segmentChanged(); }, enumerable: true });
         Object.defineProperty(SVGPathSegCurvetoCubicSmoothRel.prototype, "y2", { get: function() { return this._y2; }, set: function(y2) { this._y2 = y2; this._segmentChanged(); }, enumerable: true });

         window.SVGPathSegCurvetoQuadraticSmoothAbs = function(owningPathSegList, x, y) {
             SVGPathSeg.call(this, SVGPathSeg.PATHSEG_CURVETO_QUADRATIC_SMOOTH_ABS, "T", owningPathSegList);
             this._x = x;
             this._y = y;
         }
         SVGPathSegCurvetoQuadraticSmoothAbs.prototype = Object.create(SVGPathSeg.prototype);
         SVGPathSegCurvetoQuadraticSmoothAbs.prototype.toString = function() { return "[object SVGPathSegCurvetoQuadraticSmoothAbs]"; }
         SVGPathSegCurvetoQuadraticSmoothAbs.prototype._asPathString = function() { return this.pathSegTypeAsLetter + " " + this._x + " " + this._y; }
         SVGPathSegCurvetoQuadraticSmoothAbs.prototype.clone = function() { return new SVGPathSegCurvetoQuadraticSmoothAbs(undefined, this._x, this._y); }
         Object.defineProperty(SVGPathSegCurvetoQuadraticSmoothAbs.prototype, "x", { get: function() { return this._x; }, set: function(x) { this._x = x; this._segmentChanged(); }, enumerable: true });
         Object.defineProperty(SVGPathSegCurvetoQuadraticSmoothAbs.prototype, "y", { get: function() { return this._y; }, set: function(y) { this._y = y; this._segmentChanged(); }, enumerable: true });

         window.SVGPathSegCurvetoQuadraticSmoothRel = function(owningPathSegList, x, y) {
             SVGPathSeg.call(this, SVGPathSeg.PATHSEG_CURVETO_QUADRATIC_SMOOTH_REL, "t", owningPathSegList);
             this._x = x;
             this._y = y;
         }
         SVGPathSegCurvetoQuadraticSmoothRel.prototype = Object.create(SVGPathSeg.prototype);
         SVGPathSegCurvetoQuadraticSmoothRel.prototype.toString = function() { return "[object SVGPathSegCurvetoQuadraticSmoothRel]"; }
         SVGPathSegCurvetoQuadraticSmoothRel.prototype._asPathString = function() { return this.pathSegTypeAsLetter + " " + this._x + " " + this._y; }
         SVGPathSegCurvetoQuadraticSmoothRel.prototype.clone = function() { return new SVGPathSegCurvetoQuadraticSmoothRel(undefined, this._x, this._y); }
         Object.defineProperty(SVGPathSegCurvetoQuadraticSmoothRel.prototype, "x", { get: function() { return this._x; }, set: function(x) { this._x = x; this._segmentChanged(); }, enumerable: true });
         Object.defineProperty(SVGPathSegCurvetoQuadraticSmoothRel.prototype, "y", { get: function() { return this._y; }, set: function(y) { this._y = y; this._segmentChanged(); }, enumerable: true });

         // Add createSVGPathSeg* functions to SVGPathElement.
         // Spec: http://www.w3.org/TR/SVG11/single-page.html#paths-InterfaceSVGPathElement.
         SVGPathElement.prototype.createSVGPathSegClosePath = function() { return new SVGPathSegClosePath(undefined); }
         SVGPathElement.prototype.createSVGPathSegMovetoAbs = function(x, y) { return new SVGPathSegMovetoAbs(undefined, x, y); }
         SVGPathElement.prototype.createSVGPathSegMovetoRel = function(x, y) { return new SVGPathSegMovetoRel(undefined, x, y); }
         SVGPathElement.prototype.createSVGPathSegLinetoAbs = function(x, y) { return new SVGPathSegLinetoAbs(undefined, x, y); }
         SVGPathElement.prototype.createSVGPathSegLinetoRel = function(x, y) { return new SVGPathSegLinetoRel(undefined, x, y); }
         SVGPathElement.prototype.createSVGPathSegCurvetoCubicAbs = function(x, y, x1, y1, x2, y2) { return new SVGPathSegCurvetoCubicAbs(undefined, x, y, x1, y1, x2, y2); }
         SVGPathElement.prototype.createSVGPathSegCurvetoCubicRel = function(x, y, x1, y1, x2, y2) { return new SVGPathSegCurvetoCubicRel(undefined, x, y, x1, y1, x2, y2); }
         SVGPathElement.prototype.createSVGPathSegCurvetoQuadraticAbs = function(x, y, x1, y1) { return new SVGPathSegCurvetoQuadraticAbs(undefined, x, y, x1, y1); }
         SVGPathElement.prototype.createSVGPathSegCurvetoQuadraticRel = function(x, y, x1, y1) { return new SVGPathSegCurvetoQuadraticRel(undefined, x, y, x1, y1); }
         SVGPathElement.prototype.createSVGPathSegArcAbs = function(x, y, r1, r2, angle, largeArcFlag, sweepFlag) { return new SVGPathSegArcAbs(undefined, x, y, r1, r2, angle, largeArcFlag, sweepFlag); }
         SVGPathElement.prototype.createSVGPathSegArcRel = function(x, y, r1, r2, angle, largeArcFlag, sweepFlag) { return new SVGPathSegArcRel(undefined, x, y, r1, r2, angle, largeArcFlag, sweepFlag); }
         SVGPathElement.prototype.createSVGPathSegLinetoHorizontalAbs = function(x) { return new SVGPathSegLinetoHorizontalAbs(undefined, x); }
         SVGPathElement.prototype.createSVGPathSegLinetoHorizontalRel = function(x) { return new SVGPathSegLinetoHorizontalRel(undefined, x); }
         SVGPathElement.prototype.createSVGPathSegLinetoVerticalAbs = function(y) { return new SVGPathSegLinetoVerticalAbs(undefined, y); }
         SVGPathElement.prototype.createSVGPathSegLinetoVerticalRel = function(y) { return new SVGPathSegLinetoVerticalRel(undefined, y); }
         SVGPathElement.prototype.createSVGPathSegCurvetoCubicSmoothAbs = function(x, y, x2, y2) { return new SVGPathSegCurvetoCubicSmoothAbs(undefined, x, y, x2, y2); }
         SVGPathElement.prototype.createSVGPathSegCurvetoCubicSmoothRel = function(x, y, x2, y2) { return new SVGPathSegCurvetoCubicSmoothRel(undefined, x, y, x2, y2); }
         SVGPathElement.prototype.createSVGPathSegCurvetoQuadraticSmoothAbs = function(x, y) { return new SVGPathSegCurvetoQuadraticSmoothAbs(undefined, x, y); }
         SVGPathElement.prototype.createSVGPathSegCurvetoQuadraticSmoothRel = function(x, y) { return new SVGPathSegCurvetoQuadraticSmoothRel(undefined, x, y); }
     }

     if (!("SVGPathSegList" in window)) {
         // Spec: http://www.w3.org/TR/SVG11/single-page.html#paths-InterfaceSVGPathSegList
         window.SVGPathSegList = function(pathElement) {
             this._pathElement = pathElement;
             this._list = this._parsePath(this._pathElement.getAttribute("d"));

             // Use a MutationObserver to catch changes to the path's "d" attribute.
             this._mutationObserverConfig = { "attributes": true, "attributeFilter": ["d"] };
             this._pathElementMutationObserver = new MutationObserver(this._updateListFromPathMutations.bind(this));
             this._pathElementMutationObserver.observe(this._pathElement, this._mutationObserverConfig);
         }

         Object.defineProperty(SVGPathSegList.prototype, "numberOfItems", {
             get: function() {
                 this._checkPathSynchronizedToList();
                 return this._list.length;
             },
             enumerable: true
         });

         // Add the pathSegList accessors to SVGPathElement.
         // Spec: http://www.w3.org/TR/SVG11/single-page.html#paths-InterfaceSVGAnimatedPathData
         Object.defineProperty(SVGPathElement.prototype, "pathSegList", {
             get: function() {
                 if (!this._pathSegList)
                     this._pathSegList = new SVGPathSegList(this);
                 return this._pathSegList;
             },
             enumerable: true
         });
         // FIXME: The following are not implemented and simply return SVGPathElement.pathSegList.
         Object.defineProperty(SVGPathElement.prototype, "normalizedPathSegList", { get: function() { return this.pathSegList; }, enumerable: true });
         Object.defineProperty(SVGPathElement.prototype, "animatedPathSegList", { get: function() { return this.pathSegList; }, enumerable: true });
         Object.defineProperty(SVGPathElement.prototype, "animatedNormalizedPathSegList", { get: function() { return this.pathSegList; }, enumerable: true });

         // Process any pending mutations to the path element and update the list as needed.
         // This should be the first call of all public functions and is needed because
         // MutationObservers are not synchronous so we can have pending asynchronous mutations.
         SVGPathSegList.prototype._checkPathSynchronizedToList = function() {
             this._updateListFromPathMutations(this._pathElementMutationObserver.takeRecords());
         }

         SVGPathSegList.prototype._updateListFromPathMutations = function(mutationRecords) {
             if (!this._pathElement)
                 return;
             var hasPathMutations = false;
             mutationRecords.forEach(function(record) {
                 if (record.attributeName == "d")
                     hasPathMutations = true;
             });
             if (hasPathMutations)
                 this._list = this._parsePath(this._pathElement.getAttribute("d"));
         }

         // Serialize the list and update the path's 'd' attribute.
         SVGPathSegList.prototype._writeListToPath = function() {
             this._pathElementMutationObserver.disconnect();
             this._pathElement.setAttribute("d", SVGPathSegList._pathSegArrayAsString(this._list));
             this._pathElementMutationObserver.observe(this._pathElement, this._mutationObserverConfig);
         }

         // When a path segment changes the list needs to be synchronized back to the path element.
         SVGPathSegList.prototype.segmentChanged = function(pathSeg) {
             this._writeListToPath();
         }

         SVGPathSegList.prototype.clear = function() {
             this._checkPathSynchronizedToList();

             this._list.forEach(function(pathSeg) {
                 pathSeg._owningPathSegList = null;
             });
             this._list = [];
             this._writeListToPath();
         }

         SVGPathSegList.prototype.initialize = function(newItem) {
             this._checkPathSynchronizedToList();

             this._list = [newItem];
             newItem._owningPathSegList = this;
             this._writeListToPath();
             return newItem;
         }

         SVGPathSegList.prototype._checkValidIndex = function(index) {
             if (isNaN(index) || index < 0 || index >= this.numberOfItems)
                 throw "INDEX_SIZE_ERR";
         }

         SVGPathSegList.prototype.getItem = function(index) {
             this._checkPathSynchronizedToList();

             this._checkValidIndex(index);
             return this._list[index];
         }

         SVGPathSegList.prototype.insertItemBefore = function(newItem, index) {
             this._checkPathSynchronizedToList();

             // Spec: If the index is greater than or equal to numberOfItems, then the new item is appended to the end of the list.
             if (index > this.numberOfItems)
                 index = this.numberOfItems;
             if (newItem._owningPathSegList) {
                 // SVG2 spec says to make a copy.
                 newItem = newItem.clone();
             }
             this._list.splice(index, 0, newItem);
             newItem._owningPathSegList = this;
             this._writeListToPath();
             return newItem;
         }

         SVGPathSegList.prototype.replaceItem = function(newItem, index) {
             this._checkPathSynchronizedToList();

             if (newItem._owningPathSegList) {
                 // SVG2 spec says to make a copy.
                 newItem = newItem.clone();
             }
             this._checkValidIndex(index);
             this._list[index] = newItem;
             newItem._owningPathSegList = this;
             this._writeListToPath();
             return newItem;
         }

         SVGPathSegList.prototype.removeItem = function(index) {
             this._checkPathSynchronizedToList();

             this._checkValidIndex(index);
             var item = this._list[index];
             this._list.splice(index, 1);
             this._writeListToPath();
             return item;
         }

         SVGPathSegList.prototype.appendItem = function(newItem) {
             this._checkPathSynchronizedToList();

             if (newItem._owningPathSegList) {
                 // SVG2 spec says to make a copy.
                 newItem = newItem.clone();
             }
             this._list.push(newItem);
             newItem._owningPathSegList = this;
             // TODO: Optimize this to just append to the existing attribute.
             this._writeListToPath();
             return newItem;
         }

         SVGPathSegList._pathSegArrayAsString = function(pathSegArray) {
             var string = "";
             var first = true;
             pathSegArray.forEach(function(pathSeg) {
                 if (first) {
                     first = false;
                     string += pathSeg._asPathString();
                 } else {
                     string += " " + pathSeg._asPathString();
                 }
             });
             return string;
         }

         // This closely follows SVGPathParser::parsePath from Source/core/svg/SVGPathParser.cpp.
         SVGPathSegList.prototype._parsePath = function(string) {
             if (!string || string.length == 0)
                 return [];

             var owningPathSegList = this;

             var Builder = function() {
                 this.pathSegList = [];
             }

             Builder.prototype.appendSegment = function(pathSeg) {
                 this.pathSegList.push(pathSeg);
             }

             var Source = function(string) {
                 this._string = string;
                 this._currentIndex = 0;
                 this._endIndex = this._string.length;
                 this._previousCommand = SVGPathSeg.PATHSEG_UNKNOWN;

                 this._skipOptionalSpaces();
             }

             Source.prototype._isCurrentSpace = function() {
                 var character = this._string[this._currentIndex];
                 return character <= " " && (character == " " || character == "\n" || character == "\t" || character == "\r" || character == "\f");
             }

             Source.prototype._skipOptionalSpaces = function() {
                 while (this._currentIndex < this._endIndex && this._isCurrentSpace())
                     this._currentIndex++;
                 return this._currentIndex < this._endIndex;
             }

             Source.prototype._skipOptionalSpacesOrDelimiter = function() {
                 if (this._currentIndex < this._endIndex && !this._isCurrentSpace() && this._string.charAt(this._currentIndex) != ",")
                     return false;
                 if (this._skipOptionalSpaces()) {
                     if (this._currentIndex < this._endIndex && this._string.charAt(this._currentIndex) == ",") {
                         this._currentIndex++;
                         this._skipOptionalSpaces();
                     }
                 }
                 return this._currentIndex < this._endIndex;
             }

             Source.prototype.hasMoreData = function() {
                 return this._currentIndex < this._endIndex;
             }

             Source.prototype.peekSegmentType = function() {
                 var lookahead = this._string[this._currentIndex];
                 return this._pathSegTypeFromChar(lookahead);
             }

             Source.prototype._pathSegTypeFromChar = function(lookahead) {
                 switch (lookahead) {
                 case "Z":
                 case "z":
                     return SVGPathSeg.PATHSEG_CLOSEPATH;
                 case "M":
                     return SVGPathSeg.PATHSEG_MOVETO_ABS;
                 case "m":
                     return SVGPathSeg.PATHSEG_MOVETO_REL;
                 case "L":
                     return SVGPathSeg.PATHSEG_LINETO_ABS;
                 case "l":
                     return SVGPathSeg.PATHSEG_LINETO_REL;
                 case "C":
                     return SVGPathSeg.PATHSEG_CURVETO_CUBIC_ABS;
                 case "c":
                     return SVGPathSeg.PATHSEG_CURVETO_CUBIC_REL;
                 case "Q":
                     return SVGPathSeg.PATHSEG_CURVETO_QUADRATIC_ABS;
                 case "q":
                     return SVGPathSeg.PATHSEG_CURVETO_QUADRATIC_REL;
                 case "A":
                     return SVGPathSeg.PATHSEG_ARC_ABS;
                 case "a":
                     return SVGPathSeg.PATHSEG_ARC_REL;
                 case "H":
                     return SVGPathSeg.PATHSEG_LINETO_HORIZONTAL_ABS;
                 case "h":
                     return SVGPathSeg.PATHSEG_LINETO_HORIZONTAL_REL;
                 case "V":
                     return SVGPathSeg.PATHSEG_LINETO_VERTICAL_ABS;
                 case "v":
                     return SVGPathSeg.PATHSEG_LINETO_VERTICAL_REL;
                 case "S":
                     return SVGPathSeg.PATHSEG_CURVETO_CUBIC_SMOOTH_ABS;
                 case "s":
                     return SVGPathSeg.PATHSEG_CURVETO_CUBIC_SMOOTH_REL;
                 case "T":
                     return SVGPathSeg.PATHSEG_CURVETO_QUADRATIC_SMOOTH_ABS;
                 case "t":
                     return SVGPathSeg.PATHSEG_CURVETO_QUADRATIC_SMOOTH_REL;
                 default:
                     return SVGPathSeg.PATHSEG_UNKNOWN;
                 }
             }

             Source.prototype._nextCommandHelper = function(lookahead, previousCommand) {
                 // Check for remaining coordinates in the current command.
                 if ((lookahead == "+" || lookahead == "-" || lookahead == "." || (lookahead >= "0" && lookahead <= "9")) && previousCommand != SVGPathSeg.PATHSEG_CLOSEPATH) {
                     if (previousCommand == SVGPathSeg.PATHSEG_MOVETO_ABS)
                         return SVGPathSeg.PATHSEG_LINETO_ABS;
                     if (previousCommand == SVGPathSeg.PATHSEG_MOVETO_REL)
                         return SVGPathSeg.PATHSEG_LINETO_REL;
                     return previousCommand;
                 }
                 return SVGPathSeg.PATHSEG_UNKNOWN;
             }

             Source.prototype.initialCommandIsMoveTo = function() {
                 // If the path is empty it is still valid, so return true.
                 if (!this.hasMoreData())
                     return true;
                 var command = this.peekSegmentType();
                 // Path must start with moveTo.
                 return command == SVGPathSeg.PATHSEG_MOVETO_ABS || command == SVGPathSeg.PATHSEG_MOVETO_REL;
             }

             // Parse a number from an SVG path. This very closely follows genericParseNumber(...) from Source/core/svg/SVGParserUtilities.cpp.
             // Spec: http://www.w3.org/TR/SVG11/single-page.html#paths-PathDataBNF
             Source.prototype._parseNumber = function() {
                 var exponent = 0;
                 var integer = 0;
                 var frac = 1;
                 var decimal = 0;
                 var sign = 1;
                 var expsign = 1;

                 var startIndex = this._currentIndex;

                 this._skipOptionalSpaces();

                 // Read the sign.
                 if (this._currentIndex < this._endIndex && this._string.charAt(this._currentIndex) == "+")
                     this._currentIndex++;
                 else if (this._currentIndex < this._endIndex && this._string.charAt(this._currentIndex) == "-") {
                     this._currentIndex++;
                     sign = -1;
                 }

                 if (this._currentIndex == this._endIndex || ((this._string.charAt(this._currentIndex) < "0" || this._string.charAt(this._currentIndex) > "9") && this._string.charAt(this._currentIndex) != "."))
                     // The first character of a number must be one of [0-9+-.].
                     return undefined;

                 // Read the integer part, build right-to-left.
                 var startIntPartIndex = this._currentIndex;
                 while (this._currentIndex < this._endIndex && this._string.charAt(this._currentIndex) >= "0" && this._string.charAt(this._currentIndex) <= "9")
                     this._currentIndex++; // Advance to first non-digit.

                 if (this._currentIndex != startIntPartIndex) {
                     var scanIntPartIndex = this._currentIndex - 1;
                     var multiplier = 1;
                     while (scanIntPartIndex >= startIntPartIndex) {
                         integer += multiplier * (this._string.charAt(scanIntPartIndex--) - "0");
                         multiplier *= 10;
                     }
                 }

                 // Read the decimals.
                 if (this._currentIndex < this._endIndex && this._string.charAt(this._currentIndex) == ".") {
                     this._currentIndex++;

                     // There must be a least one digit following the .
                     if (this._currentIndex >= this._endIndex || this._string.charAt(this._currentIndex) < "0" || this._string.charAt(this._currentIndex) > "9")
                         return undefined;
                     while (this._currentIndex < this._endIndex && this._string.charAt(this._currentIndex) >= "0" && this._string.charAt(this._currentIndex) <= "9")
                         decimal += (this._string.charAt(this._currentIndex++) - "0") * (frac *= 0.1);
                 }

                 // Read the exponent part.
                 if (this._currentIndex != startIndex && this._currentIndex + 1 < this._endIndex && (this._string.charAt(this._currentIndex) == "e" || this._string.charAt(this._currentIndex) == "E") && (this._string.charAt(this._currentIndex + 1) != "x" && this._string.charAt(this._currentIndex + 1) != "m")) {
                     this._currentIndex++;

                     // Read the sign of the exponent.
                     if (this._string.charAt(this._currentIndex) == "+") {
                         this._currentIndex++;
                     } else if (this._string.charAt(this._currentIndex) == "-") {
                         this._currentIndex++;
                         expsign = -1;
                     }

                     // There must be an exponent.
                     if (this._currentIndex >= this._endIndex || this._string.charAt(this._currentIndex) < "0" || this._string.charAt(this._currentIndex) > "9")
                         return undefined;

                     while (this._currentIndex < this._endIndex && this._string.charAt(this._currentIndex) >= "0" && this._string.charAt(this._currentIndex) <= "9") {
                         exponent *= 10;
                         exponent += (this._string.charAt(this._currentIndex) - "0");
                         this._currentIndex++;
                     }
                 }

                 var number = integer + decimal;
                 number *= sign;

                 if (exponent)
                     number *= Math.pow(10, expsign * exponent);

                 if (startIndex == this._currentIndex)
                     return undefined;

                 this._skipOptionalSpacesOrDelimiter();

                 return number;
             }

             Source.prototype._parseArcFlag = function() {
                 if (this._currentIndex >= this._endIndex)
                     return undefined;
                 var flag = false;
                 var flagChar = this._string.charAt(this._currentIndex++);
                 if (flagChar == "0")
                     flag = false;
                 else if (flagChar == "1")
                     flag = true;
                 else
                     return undefined;

                 this._skipOptionalSpacesOrDelimiter();
                 return flag;
             }

             Source.prototype.parseSegment = function() {
                 var lookahead = this._string[this._currentIndex];
                 var command = this._pathSegTypeFromChar(lookahead);
                 if (command == SVGPathSeg.PATHSEG_UNKNOWN) {
                     // Possibly an implicit command. Not allowed if this is the first command.
                     if (this._previousCommand == SVGPathSeg.PATHSEG_UNKNOWN)
                         return null;
                     command = this._nextCommandHelper(lookahead, this._previousCommand);
                     if (command == SVGPathSeg.PATHSEG_UNKNOWN)
                         return null;
                 } else {
                     this._currentIndex++;
                 }

                 this._previousCommand = command;

                 switch (command) {
                 case SVGPathSeg.PATHSEG_MOVETO_REL:
                     return new SVGPathSegMovetoRel(owningPathSegList, this._parseNumber(), this._parseNumber());
                 case SVGPathSeg.PATHSEG_MOVETO_ABS:
                     return new SVGPathSegMovetoAbs(owningPathSegList, this._parseNumber(), this._parseNumber());
                 case SVGPathSeg.PATHSEG_LINETO_REL:
                     return new SVGPathSegLinetoRel(owningPathSegList, this._parseNumber(), this._parseNumber());
                 case SVGPathSeg.PATHSEG_LINETO_ABS:
                     return new SVGPathSegLinetoAbs(owningPathSegList, this._parseNumber(), this._parseNumber());
                 case SVGPathSeg.PATHSEG_LINETO_HORIZONTAL_REL:
                     return new SVGPathSegLinetoHorizontalRel(owningPathSegList, this._parseNumber());
                 case SVGPathSeg.PATHSEG_LINETO_HORIZONTAL_ABS:
                     return new SVGPathSegLinetoHorizontalAbs(owningPathSegList, this._parseNumber());
                 case SVGPathSeg.PATHSEG_LINETO_VERTICAL_REL:
                     return new SVGPathSegLinetoVerticalRel(owningPathSegList, this._parseNumber());
                 case SVGPathSeg.PATHSEG_LINETO_VERTICAL_ABS:
                     return new SVGPathSegLinetoVerticalAbs(owningPathSegList, this._parseNumber());
                 case SVGPathSeg.PATHSEG_CLOSEPATH:
                     this._skipOptionalSpaces();
                     return new SVGPathSegClosePath(owningPathSegList);
                 case SVGPathSeg.PATHSEG_CURVETO_CUBIC_REL:
                     var points = {x1: this._parseNumber(), y1: this._parseNumber(), x2: this._parseNumber(), y2: this._parseNumber(), x: this._parseNumber(), y: this._parseNumber()};
                     return new SVGPathSegCurvetoCubicRel(owningPathSegList, points.x, points.y, points.x1, points.y1, points.x2, points.y2);
                 case SVGPathSeg.PATHSEG_CURVETO_CUBIC_ABS:
                     var points = {x1: this._parseNumber(), y1: this._parseNumber(), x2: this._parseNumber(), y2: this._parseNumber(), x: this._parseNumber(), y: this._parseNumber()};
                     return new SVGPathSegCurvetoCubicAbs(owningPathSegList, points.x, points.y, points.x1, points.y1, points.x2, points.y2);
                 case SVGPathSeg.PATHSEG_CURVETO_CUBIC_SMOOTH_REL:
                     var points = {x2: this._parseNumber(), y2: this._parseNumber(), x: this._parseNumber(), y: this._parseNumber()};
                     return new SVGPathSegCurvetoCubicSmoothRel(owningPathSegList, points.x, points.y, points.x2, points.y2);
                 case SVGPathSeg.PATHSEG_CURVETO_CUBIC_SMOOTH_ABS:
                     var points = {x2: this._parseNumber(), y2: this._parseNumber(), x: this._parseNumber(), y: this._parseNumber()};
                     return new SVGPathSegCurvetoCubicSmoothAbs(owningPathSegList, points.x, points.y, points.x2, points.y2);
                 case SVGPathSeg.PATHSEG_CURVETO_QUADRATIC_REL:
                     var points = {x1: this._parseNumber(), y1: this._parseNumber(), x: this._parseNumber(), y: this._parseNumber()};
                     return new SVGPathSegCurvetoQuadraticRel(owningPathSegList, points.x, points.y, points.x1, points.y1);
                 case SVGPathSeg.PATHSEG_CURVETO_QUADRATIC_ABS:
                     var points = {x1: this._parseNumber(), y1: this._parseNumber(), x: this._parseNumber(), y: this._parseNumber()};
                     return new SVGPathSegCurvetoQuadraticAbs(owningPathSegList, points.x, points.y, points.x1, points.y1);
                 case SVGPathSeg.PATHSEG_CURVETO_QUADRATIC_SMOOTH_REL:
                     return new SVGPathSegCurvetoQuadraticSmoothRel(owningPathSegList, this._parseNumber(), this._parseNumber());
                 case SVGPathSeg.PATHSEG_CURVETO_QUADRATIC_SMOOTH_ABS:
                     return new SVGPathSegCurvetoQuadraticSmoothAbs(owningPathSegList, this._parseNumber(), this._parseNumber());
                 case SVGPathSeg.PATHSEG_ARC_REL:
                     var points = {x1: this._parseNumber(), y1: this._parseNumber(), arcAngle: this._parseNumber(), arcLarge: this._parseArcFlag(), arcSweep: this._parseArcFlag(), x: this._parseNumber(), y: this._parseNumber()};
                     return new SVGPathSegArcRel(owningPathSegList, points.x, points.y, points.x1, points.y1, points.arcAngle, points.arcLarge, points.arcSweep);
                 case SVGPathSeg.PATHSEG_ARC_ABS:
                     var points = {x1: this._parseNumber(), y1: this._parseNumber(), arcAngle: this._parseNumber(), arcLarge: this._parseArcFlag(), arcSweep: this._parseArcFlag(), x: this._parseNumber(), y: this._parseNumber()};
                     return new SVGPathSegArcAbs(owningPathSegList, points.x, points.y, points.x1, points.y1, points.arcAngle, points.arcLarge, points.arcSweep);
                 default:
                     throw "Unknown path seg type."
                 }
             }

             var builder = new Builder();
             var source = new Source(string);

             if (!source.initialCommandIsMoveTo())
                 return [];
             while (source.hasMoreData()) {
                 var pathSeg = source.parseSegment();
                 if (!pathSeg)
                     return [];
                 builder.appendSegment(pathSeg);
             }

             return builder.pathSegList;
         }
     }
    }());

    /* jshint ignore:end */

    if (typeof define === 'function' && define.amd) {
        define("c3", ["d3"], function () { return c3; });
    } else if ('undefined' !== typeof exports && 'undefined' !== typeof module) {
        module.exports = c3;
    } else {
        window.c3 = c3;
    }

})(window);
;
!function(){function n(n){return n&&(n.ownerDocument||n.document||n).documentElement}function t(n){return n&&(n.ownerDocument&&n.ownerDocument.defaultView||n.document&&n||n.defaultView)}function e(n,t){return t>n?-1:n>t?1:n>=t?0:NaN}function r(n){return null===n?NaN:+n}function i(n){return!isNaN(n)}function u(n){return{left:function(t,e,r,i){for(arguments.length<3&&(r=0),arguments.length<4&&(i=t.length);i>r;){var u=r+i>>>1;n(t[u],e)<0?r=u+1:i=u}return r},right:function(t,e,r,i){for(arguments.length<3&&(r=0),arguments.length<4&&(i=t.length);i>r;){var u=r+i>>>1;n(t[u],e)>0?i=u:r=u+1}return r}}}function o(n){return n.length}function a(n){for(var t=1;n*t%1;)t*=10;return t}function l(n,t){for(var e in t)Object.defineProperty(n.prototype,e,{value:t[e],enumerable:!1})}function c(){this._=Object.create(null)}function f(n){return(n+="")===bo||n[0]===_o?_o+n:n}function s(n){return(n+="")[0]===_o?n.slice(1):n}function h(n){return f(n)in this._}function p(n){return(n=f(n))in this._&&delete this._[n]}function g(){var n=[];for(var t in this._)n.push(s(t));return n}function v(){var n=0;for(var t in this._)++n;return n}function d(){for(var n in this._)return!1;return!0}function y(){this._=Object.create(null)}function m(n){return n}function M(n,t,e){return function(){var r=e.apply(t,arguments);return r===t?n:r}}function x(n,t){if(t in n)return t;t=t.charAt(0).toUpperCase()+t.slice(1);for(var e=0,r=wo.length;r>e;++e){var i=wo[e]+t;if(i in n)return i}}function b(){}function _(){}function w(n){function t(){for(var t,r=e,i=-1,u=r.length;++i<u;)(t=r[i].on)&&t.apply(this,arguments);return n}var e=[],r=new c;return t.on=function(t,i){var u,o=r.get(t);return arguments.length<2?o&&o.on:(o&&(o.on=null,e=e.slice(0,u=e.indexOf(o)).concat(e.slice(u+1)),r.remove(t)),i&&e.push(r.set(t,{on:i})),n)},t}function S(){ao.event.preventDefault()}function k(){for(var n,t=ao.event;n=t.sourceEvent;)t=n;return t}function N(n){for(var t=new _,e=0,r=arguments.length;++e<r;)t[arguments[e]]=w(t);return t.of=function(e,r){return function(i){try{var u=i.sourceEvent=ao.event;i.target=n,ao.event=i,t[i.type].apply(e,r)}finally{ao.event=u}}},t}function E(n){return ko(n,Co),n}function A(n){return"function"==typeof n?n:function(){return No(n,this)}}function C(n){return"function"==typeof n?n:function(){return Eo(n,this)}}function z(n,t){function e(){this.removeAttribute(n)}function r(){this.removeAttributeNS(n.space,n.local)}function i(){this.setAttribute(n,t)}function u(){this.setAttributeNS(n.space,n.local,t)}function o(){var e=t.apply(this,arguments);null==e?this.removeAttribute(n):this.setAttribute(n,e)}function a(){var e=t.apply(this,arguments);null==e?this.removeAttributeNS(n.space,n.local):this.setAttributeNS(n.space,n.local,e)}return n=ao.ns.qualify(n),null==t?n.local?r:e:"function"==typeof t?n.local?a:o:n.local?u:i}function L(n){return n.trim().replace(/\s+/g," ")}function q(n){return new RegExp("(?:^|\\s+)"+ao.requote(n)+"(?:\\s+|$)","g")}function T(n){return(n+"").trim().split(/^|\s+/)}function R(n,t){function e(){for(var e=-1;++e<i;)n[e](this,t)}function r(){for(var e=-1,r=t.apply(this,arguments);++e<i;)n[e](this,r)}n=T(n).map(D);var i=n.length;return"function"==typeof t?r:e}function D(n){var t=q(n);return function(e,r){if(i=e.classList)return r?i.add(n):i.remove(n);var i=e.getAttribute("class")||"";r?(t.lastIndex=0,t.test(i)||e.setAttribute("class",L(i+" "+n))):e.setAttribute("class",L(i.replace(t," ")))}}function P(n,t,e){function r(){this.style.removeProperty(n)}function i(){this.style.setProperty(n,t,e)}function u(){var r=t.apply(this,arguments);null==r?this.style.removeProperty(n):this.style.setProperty(n,r,e)}return null==t?r:"function"==typeof t?u:i}function U(n,t){function e(){delete this[n]}function r(){this[n]=t}function i(){var e=t.apply(this,arguments);null==e?delete this[n]:this[n]=e}return null==t?e:"function"==typeof t?i:r}function j(n){function t(){var t=this.ownerDocument,e=this.namespaceURI;return e===zo&&t.documentElement.namespaceURI===zo?t.createElement(n):t.createElementNS(e,n)}function e(){return this.ownerDocument.createElementNS(n.space,n.local)}return"function"==typeof n?n:(n=ao.ns.qualify(n)).local?e:t}function F(){var n=this.parentNode;n&&n.removeChild(this)}function H(n){return{__data__:n}}function O(n){return function(){return Ao(this,n)}}function I(n){return arguments.length||(n=e),function(t,e){return t&&e?n(t.__data__,e.__data__):!t-!e}}function Y(n,t){for(var e=0,r=n.length;r>e;e++)for(var i,u=n[e],o=0,a=u.length;a>o;o++)(i=u[o])&&t(i,o,e);return n}function Z(n){return ko(n,qo),n}function V(n){var t,e;return function(r,i,u){var o,a=n[u].update,l=a.length;for(u!=e&&(e=u,t=0),i>=t&&(t=i+1);!(o=a[t])&&++t<l;);return o}}function X(n,t,e){function r(){var t=this[o];t&&(this.removeEventListener(n,t,t.$),delete this[o])}function i(){var i=l(t,co(arguments));r.call(this),this.addEventListener(n,this[o]=i,i.$=e),i._=t}function u(){var t,e=new RegExp("^__on([^.]+)"+ao.requote(n)+"$");for(var r in this)if(t=r.match(e)){var i=this[r];this.removeEventListener(t[1],i,i.$),delete this[r]}}var o="__on"+n,a=n.indexOf("."),l=$;a>0&&(n=n.slice(0,a));var c=To.get(n);return c&&(n=c,l=B),a?t?i:r:t?b:u}function $(n,t){return function(e){var r=ao.event;ao.event=e,t[0]=this.__data__;try{n.apply(this,t)}finally{ao.event=r}}}function B(n,t){var e=$(n,t);return function(n){var t=this,r=n.relatedTarget;r&&(r===t||8&r.compareDocumentPosition(t))||e.call(t,n)}}function W(e){var r=".dragsuppress-"+ ++Do,i="click"+r,u=ao.select(t(e)).on("touchmove"+r,S).on("dragstart"+r,S).on("selectstart"+r,S);if(null==Ro&&(Ro="onselectstart"in e?!1:x(e.style,"userSelect")),Ro){var o=n(e).style,a=o[Ro];o[Ro]="none"}return function(n){if(u.on(r,null),Ro&&(o[Ro]=a),n){var t=function(){u.on(i,null)};u.on(i,function(){S(),t()},!0),setTimeout(t,0)}}}function J(n,e){e.changedTouches&&(e=e.changedTouches[0]);var r=n.ownerSVGElement||n;if(r.createSVGPoint){var i=r.createSVGPoint();if(0>Po){var u=t(n);if(u.scrollX||u.scrollY){r=ao.select("body").append("svg").style({position:"absolute",top:0,left:0,margin:0,padding:0,border:"none"},"important");var o=r[0][0].getScreenCTM();Po=!(o.f||o.e),r.remove()}}return Po?(i.x=e.pageX,i.y=e.pageY):(i.x=e.clientX,i.y=e.clientY),i=i.matrixTransform(n.getScreenCTM().inverse()),[i.x,i.y]}var a=n.getBoundingClientRect();return[e.clientX-a.left-n.clientLeft,e.clientY-a.top-n.clientTop]}function G(){return ao.event.changedTouches[0].identifier}function K(n){return n>0?1:0>n?-1:0}function Q(n,t,e){return(t[0]-n[0])*(e[1]-n[1])-(t[1]-n[1])*(e[0]-n[0])}function nn(n){return n>1?0:-1>n?Fo:Math.acos(n)}function tn(n){return n>1?Io:-1>n?-Io:Math.asin(n)}function en(n){return((n=Math.exp(n))-1/n)/2}function rn(n){return((n=Math.exp(n))+1/n)/2}function un(n){return((n=Math.exp(2*n))-1)/(n+1)}function on(n){return(n=Math.sin(n/2))*n}function an(){}function ln(n,t,e){return this instanceof ln?(this.h=+n,this.s=+t,void(this.l=+e)):arguments.length<2?n instanceof ln?new ln(n.h,n.s,n.l):_n(""+n,wn,ln):new ln(n,t,e)}function cn(n,t,e){function r(n){return n>360?n-=360:0>n&&(n+=360),60>n?u+(o-u)*n/60:180>n?o:240>n?u+(o-u)*(240-n)/60:u}function i(n){return Math.round(255*r(n))}var u,o;return n=isNaN(n)?0:(n%=360)<0?n+360:n,t=isNaN(t)?0:0>t?0:t>1?1:t,e=0>e?0:e>1?1:e,o=.5>=e?e*(1+t):e+t-e*t,u=2*e-o,new mn(i(n+120),i(n),i(n-120))}function fn(n,t,e){return this instanceof fn?(this.h=+n,this.c=+t,void(this.l=+e)):arguments.length<2?n instanceof fn?new fn(n.h,n.c,n.l):n instanceof hn?gn(n.l,n.a,n.b):gn((n=Sn((n=ao.rgb(n)).r,n.g,n.b)).l,n.a,n.b):new fn(n,t,e)}function sn(n,t,e){return isNaN(n)&&(n=0),isNaN(t)&&(t=0),new hn(e,Math.cos(n*=Yo)*t,Math.sin(n)*t)}function hn(n,t,e){return this instanceof hn?(this.l=+n,this.a=+t,void(this.b=+e)):arguments.length<2?n instanceof hn?new hn(n.l,n.a,n.b):n instanceof fn?sn(n.h,n.c,n.l):Sn((n=mn(n)).r,n.g,n.b):new hn(n,t,e)}function pn(n,t,e){var r=(n+16)/116,i=r+t/500,u=r-e/200;return i=vn(i)*na,r=vn(r)*ta,u=vn(u)*ea,new mn(yn(3.2404542*i-1.5371385*r-.4985314*u),yn(-.969266*i+1.8760108*r+.041556*u),yn(.0556434*i-.2040259*r+1.0572252*u))}function gn(n,t,e){return n>0?new fn(Math.atan2(e,t)*Zo,Math.sqrt(t*t+e*e),n):new fn(NaN,NaN,n)}function vn(n){return n>.206893034?n*n*n:(n-4/29)/7.787037}function dn(n){return n>.008856?Math.pow(n,1/3):7.787037*n+4/29}function yn(n){return Math.round(255*(.00304>=n?12.92*n:1.055*Math.pow(n,1/2.4)-.055))}function mn(n,t,e){return this instanceof mn?(this.r=~~n,this.g=~~t,void(this.b=~~e)):arguments.length<2?n instanceof mn?new mn(n.r,n.g,n.b):_n(""+n,mn,cn):new mn(n,t,e)}function Mn(n){return new mn(n>>16,n>>8&255,255&n)}function xn(n){return Mn(n)+""}function bn(n){return 16>n?"0"+Math.max(0,n).toString(16):Math.min(255,n).toString(16)}function _n(n,t,e){var r,i,u,o=0,a=0,l=0;if(r=/([a-z]+)\((.*)\)/.exec(n=n.toLowerCase()))switch(i=r[2].split(","),r[1]){case"hsl":return e(parseFloat(i[0]),parseFloat(i[1])/100,parseFloat(i[2])/100);case"rgb":return t(Nn(i[0]),Nn(i[1]),Nn(i[2]))}return(u=ua.get(n))?t(u.r,u.g,u.b):(null==n||"#"!==n.charAt(0)||isNaN(u=parseInt(n.slice(1),16))||(4===n.length?(o=(3840&u)>>4,o=o>>4|o,a=240&u,a=a>>4|a,l=15&u,l=l<<4|l):7===n.length&&(o=(16711680&u)>>16,a=(65280&u)>>8,l=255&u)),t(o,a,l))}function wn(n,t,e){var r,i,u=Math.min(n/=255,t/=255,e/=255),o=Math.max(n,t,e),a=o-u,l=(o+u)/2;return a?(i=.5>l?a/(o+u):a/(2-o-u),r=n==o?(t-e)/a+(e>t?6:0):t==o?(e-n)/a+2:(n-t)/a+4,r*=60):(r=NaN,i=l>0&&1>l?0:r),new ln(r,i,l)}function Sn(n,t,e){n=kn(n),t=kn(t),e=kn(e);var r=dn((.4124564*n+.3575761*t+.1804375*e)/na),i=dn((.2126729*n+.7151522*t+.072175*e)/ta),u=dn((.0193339*n+.119192*t+.9503041*e)/ea);return hn(116*i-16,500*(r-i),200*(i-u))}function kn(n){return(n/=255)<=.04045?n/12.92:Math.pow((n+.055)/1.055,2.4)}function Nn(n){var t=parseFloat(n);return"%"===n.charAt(n.length-1)?Math.round(2.55*t):t}function En(n){return"function"==typeof n?n:function(){return n}}function An(n){return function(t,e,r){return 2===arguments.length&&"function"==typeof e&&(r=e,e=null),Cn(t,e,n,r)}}function Cn(n,t,e,r){function i(){var n,t=l.status;if(!t&&Ln(l)||t>=200&&300>t||304===t){try{n=e.call(u,l)}catch(r){return void o.error.call(u,r)}o.load.call(u,n)}else o.error.call(u,l)}var u={},o=ao.dispatch("beforesend","progress","load","error"),a={},l=new XMLHttpRequest,c=null;return!this.XDomainRequest||"withCredentials"in l||!/^(http(s)?:)?\/\//.test(n)||(l=new XDomainRequest),"onload"in l?l.onload=l.onerror=i:l.onreadystatechange=function(){l.readyState>3&&i()},l.onprogress=function(n){var t=ao.event;ao.event=n;try{o.progress.call(u,l)}finally{ao.event=t}},u.header=function(n,t){return n=(n+"").toLowerCase(),arguments.length<2?a[n]:(null==t?delete a[n]:a[n]=t+"",u)},u.mimeType=function(n){return arguments.length?(t=null==n?null:n+"",u):t},u.responseType=function(n){return arguments.length?(c=n,u):c},u.response=function(n){return e=n,u},["get","post"].forEach(function(n){u[n]=function(){return u.send.apply(u,[n].concat(co(arguments)))}}),u.send=function(e,r,i){if(2===arguments.length&&"function"==typeof r&&(i=r,r=null),l.open(e,n,!0),null==t||"accept"in a||(a.accept=t+",*/*"),l.setRequestHeader)for(var f in a)l.setRequestHeader(f,a[f]);return null!=t&&l.overrideMimeType&&l.overrideMimeType(t),null!=c&&(l.responseType=c),null!=i&&u.on("error",i).on("load",function(n){i(null,n)}),o.beforesend.call(u,l),l.send(null==r?null:r),u},u.abort=function(){return l.abort(),u},ao.rebind(u,o,"on"),null==r?u:u.get(zn(r))}function zn(n){return 1===n.length?function(t,e){n(null==t?e:null)}:n}function Ln(n){var t=n.responseType;return t&&"text"!==t?n.response:n.responseText}function qn(n,t,e){var r=arguments.length;2>r&&(t=0),3>r&&(e=Date.now());var i=e+t,u={c:n,t:i,n:null};return aa?aa.n=u:oa=u,aa=u,la||(ca=clearTimeout(ca),la=1,fa(Tn)),u}function Tn(){var n=Rn(),t=Dn()-n;t>24?(isFinite(t)&&(clearTimeout(ca),ca=setTimeout(Tn,t)),la=0):(la=1,fa(Tn))}function Rn(){for(var n=Date.now(),t=oa;t;)n>=t.t&&t.c(n-t.t)&&(t.c=null),t=t.n;return n}function Dn(){for(var n,t=oa,e=1/0;t;)t.c?(t.t<e&&(e=t.t),t=(n=t).n):t=n?n.n=t.n:oa=t.n;return aa=n,e}function Pn(n,t){return t-(n?Math.ceil(Math.log(n)/Math.LN10):1)}function Un(n,t){var e=Math.pow(10,3*xo(8-t));return{scale:t>8?function(n){return n/e}:function(n){return n*e},symbol:n}}function jn(n){var t=n.decimal,e=n.thousands,r=n.grouping,i=n.currency,u=r&&e?function(n,t){for(var i=n.length,u=[],o=0,a=r[0],l=0;i>0&&a>0&&(l+a+1>t&&(a=Math.max(1,t-l)),u.push(n.substring(i-=a,i+a)),!((l+=a+1)>t));)a=r[o=(o+1)%r.length];return u.reverse().join(e)}:m;return function(n){var e=ha.exec(n),r=e[1]||" ",o=e[2]||">",a=e[3]||"-",l=e[4]||"",c=e[5],f=+e[6],s=e[7],h=e[8],p=e[9],g=1,v="",d="",y=!1,m=!0;switch(h&&(h=+h.substring(1)),(c||"0"===r&&"="===o)&&(c=r="0",o="="),p){case"n":s=!0,p="g";break;case"%":g=100,d="%",p="f";break;case"p":g=100,d="%",p="r";break;case"b":case"o":case"x":case"X":"#"===l&&(v="0"+p.toLowerCase());case"c":m=!1;case"d":y=!0,h=0;break;case"s":g=-1,p="r"}"$"===l&&(v=i[0],d=i[1]),"r"!=p||h||(p="g"),null!=h&&("g"==p?h=Math.max(1,Math.min(21,h)):"e"!=p&&"f"!=p||(h=Math.max(0,Math.min(20,h)))),p=pa.get(p)||Fn;var M=c&&s;return function(n){var e=d;if(y&&n%1)return"";var i=0>n||0===n&&0>1/n?(n=-n,"-"):"-"===a?"":a;if(0>g){var l=ao.formatPrefix(n,h);n=l.scale(n),e=l.symbol+d}else n*=g;n=p(n,h);var x,b,_=n.lastIndexOf(".");if(0>_){var w=m?n.lastIndexOf("e"):-1;0>w?(x=n,b=""):(x=n.substring(0,w),b=n.substring(w))}else x=n.substring(0,_),b=t+n.substring(_+1);!c&&s&&(x=u(x,1/0));var S=v.length+x.length+b.length+(M?0:i.length),k=f>S?new Array(S=f-S+1).join(r):"";return M&&(x=u(k+x,k.length?f-b.length:1/0)),i+=v,n=x+b,("<"===o?i+n+k:">"===o?k+i+n:"^"===o?k.substring(0,S>>=1)+i+n+k.substring(S):i+(M?n:k+n))+e}}}function Fn(n){return n+""}function Hn(){this._=new Date(arguments.length>1?Date.UTC.apply(this,arguments):arguments[0])}function On(n,t,e){function r(t){var e=n(t),r=u(e,1);return r-t>t-e?e:r}function i(e){return t(e=n(new va(e-1)),1),e}function u(n,e){return t(n=new va(+n),e),n}function o(n,r,u){var o=i(n),a=[];if(u>1)for(;r>o;)e(o)%u||a.push(new Date(+o)),t(o,1);else for(;r>o;)a.push(new Date(+o)),t(o,1);return a}function a(n,t,e){try{va=Hn;var r=new Hn;return r._=n,o(r,t,e)}finally{va=Date}}n.floor=n,n.round=r,n.ceil=i,n.offset=u,n.range=o;var l=n.utc=In(n);return l.floor=l,l.round=In(r),l.ceil=In(i),l.offset=In(u),l.range=a,n}function In(n){return function(t,e){try{va=Hn;var r=new Hn;return r._=t,n(r,e)._}finally{va=Date}}}function Yn(n){function t(n){function t(t){for(var e,i,u,o=[],a=-1,l=0;++a<r;)37===n.charCodeAt(a)&&(o.push(n.slice(l,a)),null!=(i=ya[e=n.charAt(++a)])&&(e=n.charAt(++a)),(u=A[e])&&(e=u(t,null==i?"e"===e?" ":"0":i)),o.push(e),l=a+1);return o.push(n.slice(l,a)),o.join("")}var r=n.length;return t.parse=function(t){var r={y:1900,m:0,d:1,H:0,M:0,S:0,L:0,Z:null},i=e(r,n,t,0);if(i!=t.length)return null;"p"in r&&(r.H=r.H%12+12*r.p);var u=null!=r.Z&&va!==Hn,o=new(u?Hn:va);return"j"in r?o.setFullYear(r.y,0,r.j):"W"in r||"U"in r?("w"in r||(r.w="W"in r?1:0),o.setFullYear(r.y,0,1),o.setFullYear(r.y,0,"W"in r?(r.w+6)%7+7*r.W-(o.getDay()+5)%7:r.w+7*r.U-(o.getDay()+6)%7)):o.setFullYear(r.y,r.m,r.d),o.setHours(r.H+(r.Z/100|0),r.M+r.Z%100,r.S,r.L),u?o._:o},t.toString=function(){return n},t}function e(n,t,e,r){for(var i,u,o,a=0,l=t.length,c=e.length;l>a;){if(r>=c)return-1;if(i=t.charCodeAt(a++),37===i){if(o=t.charAt(a++),u=C[o in ya?t.charAt(a++):o],!u||(r=u(n,e,r))<0)return-1}else if(i!=e.charCodeAt(r++))return-1}return r}function r(n,t,e){_.lastIndex=0;var r=_.exec(t.slice(e));return r?(n.w=w.get(r[0].toLowerCase()),e+r[0].length):-1}function i(n,t,e){x.lastIndex=0;var r=x.exec(t.slice(e));return r?(n.w=b.get(r[0].toLowerCase()),e+r[0].length):-1}function u(n,t,e){N.lastIndex=0;var r=N.exec(t.slice(e));return r?(n.m=E.get(r[0].toLowerCase()),e+r[0].length):-1}function o(n,t,e){S.lastIndex=0;var r=S.exec(t.slice(e));return r?(n.m=k.get(r[0].toLowerCase()),e+r[0].length):-1}function a(n,t,r){return e(n,A.c.toString(),t,r)}function l(n,t,r){return e(n,A.x.toString(),t,r)}function c(n,t,r){return e(n,A.X.toString(),t,r)}function f(n,t,e){var r=M.get(t.slice(e,e+=2).toLowerCase());return null==r?-1:(n.p=r,e)}var s=n.dateTime,h=n.date,p=n.time,g=n.periods,v=n.days,d=n.shortDays,y=n.months,m=n.shortMonths;t.utc=function(n){function e(n){try{va=Hn;var t=new va;return t._=n,r(t)}finally{va=Date}}var r=t(n);return e.parse=function(n){try{va=Hn;var t=r.parse(n);return t&&t._}finally{va=Date}},e.toString=r.toString,e},t.multi=t.utc.multi=ct;var M=ao.map(),x=Vn(v),b=Xn(v),_=Vn(d),w=Xn(d),S=Vn(y),k=Xn(y),N=Vn(m),E=Xn(m);g.forEach(function(n,t){M.set(n.toLowerCase(),t)});var A={a:function(n){return d[n.getDay()]},A:function(n){return v[n.getDay()]},b:function(n){return m[n.getMonth()]},B:function(n){return y[n.getMonth()]},c:t(s),d:function(n,t){return Zn(n.getDate(),t,2)},e:function(n,t){return Zn(n.getDate(),t,2)},H:function(n,t){return Zn(n.getHours(),t,2)},I:function(n,t){return Zn(n.getHours()%12||12,t,2)},j:function(n,t){return Zn(1+ga.dayOfYear(n),t,3)},L:function(n,t){return Zn(n.getMilliseconds(),t,3)},m:function(n,t){return Zn(n.getMonth()+1,t,2)},M:function(n,t){return Zn(n.getMinutes(),t,2)},p:function(n){return g[+(n.getHours()>=12)]},S:function(n,t){return Zn(n.getSeconds(),t,2)},U:function(n,t){return Zn(ga.sundayOfYear(n),t,2)},w:function(n){return n.getDay()},W:function(n,t){return Zn(ga.mondayOfYear(n),t,2)},x:t(h),X:t(p),y:function(n,t){return Zn(n.getFullYear()%100,t,2)},Y:function(n,t){return Zn(n.getFullYear()%1e4,t,4)},Z:at,"%":function(){return"%"}},C={a:r,A:i,b:u,B:o,c:a,d:tt,e:tt,H:rt,I:rt,j:et,L:ot,m:nt,M:it,p:f,S:ut,U:Bn,w:$n,W:Wn,x:l,X:c,y:Gn,Y:Jn,Z:Kn,"%":lt};return t}function Zn(n,t,e){var r=0>n?"-":"",i=(r?-n:n)+"",u=i.length;return r+(e>u?new Array(e-u+1).join(t)+i:i)}function Vn(n){return new RegExp("^(?:"+n.map(ao.requote).join("|")+")","i")}function Xn(n){for(var t=new c,e=-1,r=n.length;++e<r;)t.set(n[e].toLowerCase(),e);return t}function $n(n,t,e){ma.lastIndex=0;var r=ma.exec(t.slice(e,e+1));return r?(n.w=+r[0],e+r[0].length):-1}function Bn(n,t,e){ma.lastIndex=0;var r=ma.exec(t.slice(e));return r?(n.U=+r[0],e+r[0].length):-1}function Wn(n,t,e){ma.lastIndex=0;var r=ma.exec(t.slice(e));return r?(n.W=+r[0],e+r[0].length):-1}function Jn(n,t,e){ma.lastIndex=0;var r=ma.exec(t.slice(e,e+4));return r?(n.y=+r[0],e+r[0].length):-1}function Gn(n,t,e){ma.lastIndex=0;var r=ma.exec(t.slice(e,e+2));return r?(n.y=Qn(+r[0]),e+r[0].length):-1}function Kn(n,t,e){return/^[+-]\d{4}$/.test(t=t.slice(e,e+5))?(n.Z=-t,e+5):-1}function Qn(n){return n+(n>68?1900:2e3)}function nt(n,t,e){ma.lastIndex=0;var r=ma.exec(t.slice(e,e+2));return r?(n.m=r[0]-1,e+r[0].length):-1}function tt(n,t,e){ma.lastIndex=0;var r=ma.exec(t.slice(e,e+2));return r?(n.d=+r[0],e+r[0].length):-1}function et(n,t,e){ma.lastIndex=0;var r=ma.exec(t.slice(e,e+3));return r?(n.j=+r[0],e+r[0].length):-1}function rt(n,t,e){ma.lastIndex=0;var r=ma.exec(t.slice(e,e+2));return r?(n.H=+r[0],e+r[0].length):-1}function it(n,t,e){ma.lastIndex=0;var r=ma.exec(t.slice(e,e+2));return r?(n.M=+r[0],e+r[0].length):-1}function ut(n,t,e){ma.lastIndex=0;var r=ma.exec(t.slice(e,e+2));return r?(n.S=+r[0],e+r[0].length):-1}function ot(n,t,e){ma.lastIndex=0;var r=ma.exec(t.slice(e,e+3));return r?(n.L=+r[0],e+r[0].length):-1}function at(n){var t=n.getTimezoneOffset(),e=t>0?"-":"+",r=xo(t)/60|0,i=xo(t)%60;return e+Zn(r,"0",2)+Zn(i,"0",2)}function lt(n,t,e){Ma.lastIndex=0;var r=Ma.exec(t.slice(e,e+1));return r?e+r[0].length:-1}function ct(n){for(var t=n.length,e=-1;++e<t;)n[e][0]=this(n[e][0]);return function(t){for(var e=0,r=n[e];!r[1](t);)r=n[++e];return r[0](t)}}function ft(){}function st(n,t,e){var r=e.s=n+t,i=r-n,u=r-i;e.t=n-u+(t-i)}function ht(n,t){n&&wa.hasOwnProperty(n.type)&&wa[n.type](n,t)}function pt(n,t,e){var r,i=-1,u=n.length-e;for(t.lineStart();++i<u;)r=n[i],t.point(r[0],r[1],r[2]);t.lineEnd()}function gt(n,t){var e=-1,r=n.length;for(t.polygonStart();++e<r;)pt(n[e],t,1);t.polygonEnd()}function vt(){function n(n,t){n*=Yo,t=t*Yo/2+Fo/4;var e=n-r,o=e>=0?1:-1,a=o*e,l=Math.cos(t),c=Math.sin(t),f=u*c,s=i*l+f*Math.cos(a),h=f*o*Math.sin(a);ka.add(Math.atan2(h,s)),r=n,i=l,u=c}var t,e,r,i,u;Na.point=function(o,a){Na.point=n,r=(t=o)*Yo,i=Math.cos(a=(e=a)*Yo/2+Fo/4),u=Math.sin(a)},Na.lineEnd=function(){n(t,e)}}function dt(n){var t=n[0],e=n[1],r=Math.cos(e);return[r*Math.cos(t),r*Math.sin(t),Math.sin(e)]}function yt(n,t){return n[0]*t[0]+n[1]*t[1]+n[2]*t[2]}function mt(n,t){return[n[1]*t[2]-n[2]*t[1],n[2]*t[0]-n[0]*t[2],n[0]*t[1]-n[1]*t[0]]}function Mt(n,t){n[0]+=t[0],n[1]+=t[1],n[2]+=t[2]}function xt(n,t){return[n[0]*t,n[1]*t,n[2]*t]}function bt(n){var t=Math.sqrt(n[0]*n[0]+n[1]*n[1]+n[2]*n[2]);n[0]/=t,n[1]/=t,n[2]/=t}function _t(n){return[Math.atan2(n[1],n[0]),tn(n[2])]}function wt(n,t){return xo(n[0]-t[0])<Uo&&xo(n[1]-t[1])<Uo}function St(n,t){n*=Yo;var e=Math.cos(t*=Yo);kt(e*Math.cos(n),e*Math.sin(n),Math.sin(t))}function kt(n,t,e){++Ea,Ca+=(n-Ca)/Ea,za+=(t-za)/Ea,La+=(e-La)/Ea}function Nt(){function n(n,i){n*=Yo;var u=Math.cos(i*=Yo),o=u*Math.cos(n),a=u*Math.sin(n),l=Math.sin(i),c=Math.atan2(Math.sqrt((c=e*l-r*a)*c+(c=r*o-t*l)*c+(c=t*a-e*o)*c),t*o+e*a+r*l);Aa+=c,qa+=c*(t+(t=o)),Ta+=c*(e+(e=a)),Ra+=c*(r+(r=l)),kt(t,e,r)}var t,e,r;ja.point=function(i,u){i*=Yo;var o=Math.cos(u*=Yo);t=o*Math.cos(i),e=o*Math.sin(i),r=Math.sin(u),ja.point=n,kt(t,e,r)}}function Et(){ja.point=St}function At(){function n(n,t){n*=Yo;var e=Math.cos(t*=Yo),o=e*Math.cos(n),a=e*Math.sin(n),l=Math.sin(t),c=i*l-u*a,f=u*o-r*l,s=r*a-i*o,h=Math.sqrt(c*c+f*f+s*s),p=r*o+i*a+u*l,g=h&&-nn(p)/h,v=Math.atan2(h,p);Da+=g*c,Pa+=g*f,Ua+=g*s,Aa+=v,qa+=v*(r+(r=o)),Ta+=v*(i+(i=a)),Ra+=v*(u+(u=l)),kt(r,i,u)}var t,e,r,i,u;ja.point=function(o,a){t=o,e=a,ja.point=n,o*=Yo;var l=Math.cos(a*=Yo);r=l*Math.cos(o),i=l*Math.sin(o),u=Math.sin(a),kt(r,i,u)},ja.lineEnd=function(){n(t,e),ja.lineEnd=Et,ja.point=St}}function Ct(n,t){function e(e,r){return e=n(e,r),t(e[0],e[1])}return n.invert&&t.invert&&(e.invert=function(e,r){return e=t.invert(e,r),e&&n.invert(e[0],e[1])}),e}function zt(){return!0}function Lt(n,t,e,r,i){var u=[],o=[];if(n.forEach(function(n){if(!((t=n.length-1)<=0)){var t,e=n[0],r=n[t];if(wt(e,r)){i.lineStart();for(var a=0;t>a;++a)i.point((e=n[a])[0],e[1]);return void i.lineEnd()}var l=new Tt(e,n,null,!0),c=new Tt(e,null,l,!1);l.o=c,u.push(l),o.push(c),l=new Tt(r,n,null,!1),c=new Tt(r,null,l,!0),l.o=c,u.push(l),o.push(c)}}),o.sort(t),qt(u),qt(o),u.length){for(var a=0,l=e,c=o.length;c>a;++a)o[a].e=l=!l;for(var f,s,h=u[0];;){for(var p=h,g=!0;p.v;)if((p=p.n)===h)return;f=p.z,i.lineStart();do{if(p.v=p.o.v=!0,p.e){if(g)for(var a=0,c=f.length;c>a;++a)i.point((s=f[a])[0],s[1]);else r(p.x,p.n.x,1,i);p=p.n}else{if(g){f=p.p.z;for(var a=f.length-1;a>=0;--a)i.point((s=f[a])[0],s[1])}else r(p.x,p.p.x,-1,i);p=p.p}p=p.o,f=p.z,g=!g}while(!p.v);i.lineEnd()}}}function qt(n){if(t=n.length){for(var t,e,r=0,i=n[0];++r<t;)i.n=e=n[r],e.p=i,i=e;i.n=e=n[0],e.p=i}}function Tt(n,t,e,r){this.x=n,this.z=t,this.o=e,this.e=r,this.v=!1,this.n=this.p=null}function Rt(n,t,e,r){return function(i,u){function o(t,e){var r=i(t,e);n(t=r[0],e=r[1])&&u.point(t,e)}function a(n,t){var e=i(n,t);d.point(e[0],e[1])}function l(){m.point=a,d.lineStart()}function c(){m.point=o,d.lineEnd()}function f(n,t){v.push([n,t]);var e=i(n,t);x.point(e[0],e[1])}function s(){x.lineStart(),v=[]}function h(){f(v[0][0],v[0][1]),x.lineEnd();var n,t=x.clean(),e=M.buffer(),r=e.length;if(v.pop(),g.push(v),v=null,r)if(1&t){n=e[0];var i,r=n.length-1,o=-1;if(r>0){for(b||(u.polygonStart(),b=!0),u.lineStart();++o<r;)u.point((i=n[o])[0],i[1]);u.lineEnd()}}else r>1&&2&t&&e.push(e.pop().concat(e.shift())),p.push(e.filter(Dt))}var p,g,v,d=t(u),y=i.invert(r[0],r[1]),m={point:o,lineStart:l,lineEnd:c,polygonStart:function(){m.point=f,m.lineStart=s,m.lineEnd=h,p=[],g=[]},polygonEnd:function(){m.point=o,m.lineStart=l,m.lineEnd=c,p=ao.merge(p);var n=Ot(y,g);p.length?(b||(u.polygonStart(),b=!0),Lt(p,Ut,n,e,u)):n&&(b||(u.polygonStart(),b=!0),u.lineStart(),e(null,null,1,u),u.lineEnd()),b&&(u.polygonEnd(),b=!1),p=g=null},sphere:function(){u.polygonStart(),u.lineStart(),e(null,null,1,u),u.lineEnd(),u.polygonEnd()}},M=Pt(),x=t(M),b=!1;return m}}function Dt(n){return n.length>1}function Pt(){var n,t=[];return{lineStart:function(){t.push(n=[])},point:function(t,e){n.push([t,e])},lineEnd:b,buffer:function(){var e=t;return t=[],n=null,e},rejoin:function(){t.length>1&&t.push(t.pop().concat(t.shift()))}}}function Ut(n,t){return((n=n.x)[0]<0?n[1]-Io-Uo:Io-n[1])-((t=t.x)[0]<0?t[1]-Io-Uo:Io-t[1])}function jt(n){var t,e=NaN,r=NaN,i=NaN;return{lineStart:function(){n.lineStart(),t=1},point:function(u,o){var a=u>0?Fo:-Fo,l=xo(u-e);xo(l-Fo)<Uo?(n.point(e,r=(r+o)/2>0?Io:-Io),n.point(i,r),n.lineEnd(),n.lineStart(),n.point(a,r),n.point(u,r),t=0):i!==a&&l>=Fo&&(xo(e-i)<Uo&&(e-=i*Uo),xo(u-a)<Uo&&(u-=a*Uo),r=Ft(e,r,u,o),n.point(i,r),n.lineEnd(),n.lineStart(),n.point(a,r),t=0),n.point(e=u,r=o),i=a},lineEnd:function(){n.lineEnd(),e=r=NaN},clean:function(){return 2-t}}}function Ft(n,t,e,r){var i,u,o=Math.sin(n-e);return xo(o)>Uo?Math.atan((Math.sin(t)*(u=Math.cos(r))*Math.sin(e)-Math.sin(r)*(i=Math.cos(t))*Math.sin(n))/(i*u*o)):(t+r)/2}function Ht(n,t,e,r){var i;if(null==n)i=e*Io,r.point(-Fo,i),r.point(0,i),r.point(Fo,i),r.point(Fo,0),r.point(Fo,-i),r.point(0,-i),r.point(-Fo,-i),r.point(-Fo,0),r.point(-Fo,i);else if(xo(n[0]-t[0])>Uo){var u=n[0]<t[0]?Fo:-Fo;i=e*u/2,r.point(-u,i),r.point(0,i),r.point(u,i)}else r.point(t[0],t[1])}function Ot(n,t){var e=n[0],r=n[1],i=[Math.sin(e),-Math.cos(e),0],u=0,o=0;ka.reset();for(var a=0,l=t.length;l>a;++a){var c=t[a],f=c.length;if(f)for(var s=c[0],h=s[0],p=s[1]/2+Fo/4,g=Math.sin(p),v=Math.cos(p),d=1;;){d===f&&(d=0),n=c[d];var y=n[0],m=n[1]/2+Fo/4,M=Math.sin(m),x=Math.cos(m),b=y-h,_=b>=0?1:-1,w=_*b,S=w>Fo,k=g*M;if(ka.add(Math.atan2(k*_*Math.sin(w),v*x+k*Math.cos(w))),u+=S?b+_*Ho:b,S^h>=e^y>=e){var N=mt(dt(s),dt(n));bt(N);var E=mt(i,N);bt(E);var A=(S^b>=0?-1:1)*tn(E[2]);(r>A||r===A&&(N[0]||N[1]))&&(o+=S^b>=0?1:-1)}if(!d++)break;h=y,g=M,v=x,s=n}}return(-Uo>u||Uo>u&&-Uo>ka)^1&o}function It(n){function t(n,t){return Math.cos(n)*Math.cos(t)>u}function e(n){var e,u,l,c,f;return{lineStart:function(){c=l=!1,f=1},point:function(s,h){var p,g=[s,h],v=t(s,h),d=o?v?0:i(s,h):v?i(s+(0>s?Fo:-Fo),h):0;if(!e&&(c=l=v)&&n.lineStart(),v!==l&&(p=r(e,g),(wt(e,p)||wt(g,p))&&(g[0]+=Uo,g[1]+=Uo,v=t(g[0],g[1]))),v!==l)f=0,v?(n.lineStart(),p=r(g,e),n.point(p[0],p[1])):(p=r(e,g),n.point(p[0],p[1]),n.lineEnd()),e=p;else if(a&&e&&o^v){var y;d&u||!(y=r(g,e,!0))||(f=0,o?(n.lineStart(),n.point(y[0][0],y[0][1]),n.point(y[1][0],y[1][1]),n.lineEnd()):(n.point(y[1][0],y[1][1]),n.lineEnd(),n.lineStart(),n.point(y[0][0],y[0][1])))}!v||e&&wt(e,g)||n.point(g[0],g[1]),e=g,l=v,u=d},lineEnd:function(){l&&n.lineEnd(),e=null},clean:function(){return f|(c&&l)<<1}}}function r(n,t,e){var r=dt(n),i=dt(t),o=[1,0,0],a=mt(r,i),l=yt(a,a),c=a[0],f=l-c*c;if(!f)return!e&&n;var s=u*l/f,h=-u*c/f,p=mt(o,a),g=xt(o,s),v=xt(a,h);Mt(g,v);var d=p,y=yt(g,d),m=yt(d,d),M=y*y-m*(yt(g,g)-1);if(!(0>M)){var x=Math.sqrt(M),b=xt(d,(-y-x)/m);if(Mt(b,g),b=_t(b),!e)return b;var _,w=n[0],S=t[0],k=n[1],N=t[1];w>S&&(_=w,w=S,S=_);var E=S-w,A=xo(E-Fo)<Uo,C=A||Uo>E;if(!A&&k>N&&(_=k,k=N,N=_),C?A?k+N>0^b[1]<(xo(b[0]-w)<Uo?k:N):k<=b[1]&&b[1]<=N:E>Fo^(w<=b[0]&&b[0]<=S)){var z=xt(d,(-y+x)/m);return Mt(z,g),[b,_t(z)]}}}function i(t,e){var r=o?n:Fo-n,i=0;return-r>t?i|=1:t>r&&(i|=2),-r>e?i|=4:e>r&&(i|=8),i}var u=Math.cos(n),o=u>0,a=xo(u)>Uo,l=ve(n,6*Yo);return Rt(t,e,l,o?[0,-n]:[-Fo,n-Fo])}function Yt(n,t,e,r){return function(i){var u,o=i.a,a=i.b,l=o.x,c=o.y,f=a.x,s=a.y,h=0,p=1,g=f-l,v=s-c;if(u=n-l,g||!(u>0)){if(u/=g,0>g){if(h>u)return;p>u&&(p=u)}else if(g>0){if(u>p)return;u>h&&(h=u)}if(u=e-l,g||!(0>u)){if(u/=g,0>g){if(u>p)return;u>h&&(h=u)}else if(g>0){if(h>u)return;p>u&&(p=u)}if(u=t-c,v||!(u>0)){if(u/=v,0>v){if(h>u)return;p>u&&(p=u)}else if(v>0){if(u>p)return;u>h&&(h=u)}if(u=r-c,v||!(0>u)){if(u/=v,0>v){if(u>p)return;u>h&&(h=u)}else if(v>0){if(h>u)return;p>u&&(p=u)}return h>0&&(i.a={x:l+h*g,y:c+h*v}),1>p&&(i.b={x:l+p*g,y:c+p*v}),i}}}}}}function Zt(n,t,e,r){function i(r,i){return xo(r[0]-n)<Uo?i>0?0:3:xo(r[0]-e)<Uo?i>0?2:1:xo(r[1]-t)<Uo?i>0?1:0:i>0?3:2}function u(n,t){return o(n.x,t.x)}function o(n,t){var e=i(n,1),r=i(t,1);return e!==r?e-r:0===e?t[1]-n[1]:1===e?n[0]-t[0]:2===e?n[1]-t[1]:t[0]-n[0]}return function(a){function l(n){for(var t=0,e=d.length,r=n[1],i=0;e>i;++i)for(var u,o=1,a=d[i],l=a.length,c=a[0];l>o;++o)u=a[o],c[1]<=r?u[1]>r&&Q(c,u,n)>0&&++t:u[1]<=r&&Q(c,u,n)<0&&--t,c=u;return 0!==t}function c(u,a,l,c){var f=0,s=0;if(null==u||(f=i(u,l))!==(s=i(a,l))||o(u,a)<0^l>0){do c.point(0===f||3===f?n:e,f>1?r:t);while((f=(f+l+4)%4)!==s)}else c.point(a[0],a[1])}function f(i,u){return i>=n&&e>=i&&u>=t&&r>=u}function s(n,t){f(n,t)&&a.point(n,t)}function h(){C.point=g,d&&d.push(y=[]),S=!0,w=!1,b=_=NaN}function p(){v&&(g(m,M),x&&w&&E.rejoin(),v.push(E.buffer())),C.point=s,w&&a.lineEnd()}function g(n,t){n=Math.max(-Ha,Math.min(Ha,n)),t=Math.max(-Ha,Math.min(Ha,t));var e=f(n,t);if(d&&y.push([n,t]),S)m=n,M=t,x=e,S=!1,e&&(a.lineStart(),a.point(n,t));else if(e&&w)a.point(n,t);else{var r={a:{x:b,y:_},b:{x:n,y:t}};A(r)?(w||(a.lineStart(),a.point(r.a.x,r.a.y)),a.point(r.b.x,r.b.y),e||a.lineEnd(),k=!1):e&&(a.lineStart(),a.point(n,t),k=!1)}b=n,_=t,w=e}var v,d,y,m,M,x,b,_,w,S,k,N=a,E=Pt(),A=Yt(n,t,e,r),C={point:s,lineStart:h,lineEnd:p,polygonStart:function(){a=E,v=[],d=[],k=!0},polygonEnd:function(){a=N,v=ao.merge(v);var t=l([n,r]),e=k&&t,i=v.length;(e||i)&&(a.polygonStart(),e&&(a.lineStart(),c(null,null,1,a),a.lineEnd()),i&&Lt(v,u,t,c,a),a.polygonEnd()),v=d=y=null}};return C}}function Vt(n){var t=0,e=Fo/3,r=ae(n),i=r(t,e);return i.parallels=function(n){return arguments.length?r(t=n[0]*Fo/180,e=n[1]*Fo/180):[t/Fo*180,e/Fo*180]},i}function Xt(n,t){function e(n,t){var e=Math.sqrt(u-2*i*Math.sin(t))/i;return[e*Math.sin(n*=i),o-e*Math.cos(n)]}var r=Math.sin(n),i=(r+Math.sin(t))/2,u=1+r*(2*i-r),o=Math.sqrt(u)/i;return e.invert=function(n,t){var e=o-t;return[Math.atan2(n,e)/i,tn((u-(n*n+e*e)*i*i)/(2*i))]},e}function $t(){function n(n,t){Ia+=i*n-r*t,r=n,i=t}var t,e,r,i;$a.point=function(u,o){$a.point=n,t=r=u,e=i=o},$a.lineEnd=function(){n(t,e)}}function Bt(n,t){Ya>n&&(Ya=n),n>Va&&(Va=n),Za>t&&(Za=t),t>Xa&&(Xa=t)}function Wt(){function n(n,t){o.push("M",n,",",t,u)}function t(n,t){o.push("M",n,",",t),a.point=e}function e(n,t){o.push("L",n,",",t)}function r(){a.point=n}function i(){o.push("Z")}var u=Jt(4.5),o=[],a={point:n,lineStart:function(){a.point=t},lineEnd:r,polygonStart:function(){a.lineEnd=i},polygonEnd:function(){a.lineEnd=r,a.point=n},pointRadius:function(n){return u=Jt(n),a},result:function(){if(o.length){var n=o.join("");return o=[],n}}};return a}function Jt(n){return"m0,"+n+"a"+n+","+n+" 0 1,1 0,"+-2*n+"a"+n+","+n+" 0 1,1 0,"+2*n+"z"}function Gt(n,t){Ca+=n,za+=t,++La}function Kt(){function n(n,r){var i=n-t,u=r-e,o=Math.sqrt(i*i+u*u);qa+=o*(t+n)/2,Ta+=o*(e+r)/2,Ra+=o,Gt(t=n,e=r)}var t,e;Wa.point=function(r,i){Wa.point=n,Gt(t=r,e=i)}}function Qt(){Wa.point=Gt}function ne(){function n(n,t){var e=n-r,u=t-i,o=Math.sqrt(e*e+u*u);qa+=o*(r+n)/2,Ta+=o*(i+t)/2,Ra+=o,o=i*n-r*t,Da+=o*(r+n),Pa+=o*(i+t),Ua+=3*o,Gt(r=n,i=t)}var t,e,r,i;Wa.point=function(u,o){Wa.point=n,Gt(t=r=u,e=i=o)},Wa.lineEnd=function(){n(t,e)}}function te(n){function t(t,e){n.moveTo(t+o,e),n.arc(t,e,o,0,Ho)}function e(t,e){n.moveTo(t,e),a.point=r}function r(t,e){n.lineTo(t,e)}function i(){a.point=t}function u(){n.closePath()}var o=4.5,a={point:t,lineStart:function(){a.point=e},lineEnd:i,polygonStart:function(){a.lineEnd=u},polygonEnd:function(){a.lineEnd=i,a.point=t},pointRadius:function(n){return o=n,a},result:b};return a}function ee(n){function t(n){return(a?r:e)(n)}function e(t){return ue(t,function(e,r){e=n(e,r),t.point(e[0],e[1])})}function r(t){function e(e,r){e=n(e,r),t.point(e[0],e[1])}function r(){M=NaN,S.point=u,t.lineStart()}function u(e,r){var u=dt([e,r]),o=n(e,r);i(M,x,m,b,_,w,M=o[0],x=o[1],m=e,b=u[0],_=u[1],w=u[2],a,t),t.point(M,x)}function o(){S.point=e,t.lineEnd()}function l(){
r(),S.point=c,S.lineEnd=f}function c(n,t){u(s=n,h=t),p=M,g=x,v=b,d=_,y=w,S.point=u}function f(){i(M,x,m,b,_,w,p,g,s,v,d,y,a,t),S.lineEnd=o,o()}var s,h,p,g,v,d,y,m,M,x,b,_,w,S={point:e,lineStart:r,lineEnd:o,polygonStart:function(){t.polygonStart(),S.lineStart=l},polygonEnd:function(){t.polygonEnd(),S.lineStart=r}};return S}function i(t,e,r,a,l,c,f,s,h,p,g,v,d,y){var m=f-t,M=s-e,x=m*m+M*M;if(x>4*u&&d--){var b=a+p,_=l+g,w=c+v,S=Math.sqrt(b*b+_*_+w*w),k=Math.asin(w/=S),N=xo(xo(w)-1)<Uo||xo(r-h)<Uo?(r+h)/2:Math.atan2(_,b),E=n(N,k),A=E[0],C=E[1],z=A-t,L=C-e,q=M*z-m*L;(q*q/x>u||xo((m*z+M*L)/x-.5)>.3||o>a*p+l*g+c*v)&&(i(t,e,r,a,l,c,A,C,N,b/=S,_/=S,w,d,y),y.point(A,C),i(A,C,N,b,_,w,f,s,h,p,g,v,d,y))}}var u=.5,o=Math.cos(30*Yo),a=16;return t.precision=function(n){return arguments.length?(a=(u=n*n)>0&&16,t):Math.sqrt(u)},t}function re(n){var t=ee(function(t,e){return n([t*Zo,e*Zo])});return function(n){return le(t(n))}}function ie(n){this.stream=n}function ue(n,t){return{point:t,sphere:function(){n.sphere()},lineStart:function(){n.lineStart()},lineEnd:function(){n.lineEnd()},polygonStart:function(){n.polygonStart()},polygonEnd:function(){n.polygonEnd()}}}function oe(n){return ae(function(){return n})()}function ae(n){function t(n){return n=a(n[0]*Yo,n[1]*Yo),[n[0]*h+l,c-n[1]*h]}function e(n){return n=a.invert((n[0]-l)/h,(c-n[1])/h),n&&[n[0]*Zo,n[1]*Zo]}function r(){a=Ct(o=se(y,M,x),u);var n=u(v,d);return l=p-n[0]*h,c=g+n[1]*h,i()}function i(){return f&&(f.valid=!1,f=null),t}var u,o,a,l,c,f,s=ee(function(n,t){return n=u(n,t),[n[0]*h+l,c-n[1]*h]}),h=150,p=480,g=250,v=0,d=0,y=0,M=0,x=0,b=Fa,_=m,w=null,S=null;return t.stream=function(n){return f&&(f.valid=!1),f=le(b(o,s(_(n)))),f.valid=!0,f},t.clipAngle=function(n){return arguments.length?(b=null==n?(w=n,Fa):It((w=+n)*Yo),i()):w},t.clipExtent=function(n){return arguments.length?(S=n,_=n?Zt(n[0][0],n[0][1],n[1][0],n[1][1]):m,i()):S},t.scale=function(n){return arguments.length?(h=+n,r()):h},t.translate=function(n){return arguments.length?(p=+n[0],g=+n[1],r()):[p,g]},t.center=function(n){return arguments.length?(v=n[0]%360*Yo,d=n[1]%360*Yo,r()):[v*Zo,d*Zo]},t.rotate=function(n){return arguments.length?(y=n[0]%360*Yo,M=n[1]%360*Yo,x=n.length>2?n[2]%360*Yo:0,r()):[y*Zo,M*Zo,x*Zo]},ao.rebind(t,s,"precision"),function(){return u=n.apply(this,arguments),t.invert=u.invert&&e,r()}}function le(n){return ue(n,function(t,e){n.point(t*Yo,e*Yo)})}function ce(n,t){return[n,t]}function fe(n,t){return[n>Fo?n-Ho:-Fo>n?n+Ho:n,t]}function se(n,t,e){return n?t||e?Ct(pe(n),ge(t,e)):pe(n):t||e?ge(t,e):fe}function he(n){return function(t,e){return t+=n,[t>Fo?t-Ho:-Fo>t?t+Ho:t,e]}}function pe(n){var t=he(n);return t.invert=he(-n),t}function ge(n,t){function e(n,t){var e=Math.cos(t),a=Math.cos(n)*e,l=Math.sin(n)*e,c=Math.sin(t),f=c*r+a*i;return[Math.atan2(l*u-f*o,a*r-c*i),tn(f*u+l*o)]}var r=Math.cos(n),i=Math.sin(n),u=Math.cos(t),o=Math.sin(t);return e.invert=function(n,t){var e=Math.cos(t),a=Math.cos(n)*e,l=Math.sin(n)*e,c=Math.sin(t),f=c*u-l*o;return[Math.atan2(l*u+c*o,a*r+f*i),tn(f*r-a*i)]},e}function ve(n,t){var e=Math.cos(n),r=Math.sin(n);return function(i,u,o,a){var l=o*t;null!=i?(i=de(e,i),u=de(e,u),(o>0?u>i:i>u)&&(i+=o*Ho)):(i=n+o*Ho,u=n-.5*l);for(var c,f=i;o>0?f>u:u>f;f-=l)a.point((c=_t([e,-r*Math.cos(f),-r*Math.sin(f)]))[0],c[1])}}function de(n,t){var e=dt(t);e[0]-=n,bt(e);var r=nn(-e[1]);return((-e[2]<0?-r:r)+2*Math.PI-Uo)%(2*Math.PI)}function ye(n,t,e){var r=ao.range(n,t-Uo,e).concat(t);return function(n){return r.map(function(t){return[n,t]})}}function me(n,t,e){var r=ao.range(n,t-Uo,e).concat(t);return function(n){return r.map(function(t){return[t,n]})}}function Me(n){return n.source}function xe(n){return n.target}function be(n,t,e,r){var i=Math.cos(t),u=Math.sin(t),o=Math.cos(r),a=Math.sin(r),l=i*Math.cos(n),c=i*Math.sin(n),f=o*Math.cos(e),s=o*Math.sin(e),h=2*Math.asin(Math.sqrt(on(r-t)+i*o*on(e-n))),p=1/Math.sin(h),g=h?function(n){var t=Math.sin(n*=h)*p,e=Math.sin(h-n)*p,r=e*l+t*f,i=e*c+t*s,o=e*u+t*a;return[Math.atan2(i,r)*Zo,Math.atan2(o,Math.sqrt(r*r+i*i))*Zo]}:function(){return[n*Zo,t*Zo]};return g.distance=h,g}function _e(){function n(n,i){var u=Math.sin(i*=Yo),o=Math.cos(i),a=xo((n*=Yo)-t),l=Math.cos(a);Ja+=Math.atan2(Math.sqrt((a=o*Math.sin(a))*a+(a=r*u-e*o*l)*a),e*u+r*o*l),t=n,e=u,r=o}var t,e,r;Ga.point=function(i,u){t=i*Yo,e=Math.sin(u*=Yo),r=Math.cos(u),Ga.point=n},Ga.lineEnd=function(){Ga.point=Ga.lineEnd=b}}function we(n,t){function e(t,e){var r=Math.cos(t),i=Math.cos(e),u=n(r*i);return[u*i*Math.sin(t),u*Math.sin(e)]}return e.invert=function(n,e){var r=Math.sqrt(n*n+e*e),i=t(r),u=Math.sin(i),o=Math.cos(i);return[Math.atan2(n*u,r*o),Math.asin(r&&e*u/r)]},e}function Se(n,t){function e(n,t){o>0?-Io+Uo>t&&(t=-Io+Uo):t>Io-Uo&&(t=Io-Uo);var e=o/Math.pow(i(t),u);return[e*Math.sin(u*n),o-e*Math.cos(u*n)]}var r=Math.cos(n),i=function(n){return Math.tan(Fo/4+n/2)},u=n===t?Math.sin(n):Math.log(r/Math.cos(t))/Math.log(i(t)/i(n)),o=r*Math.pow(i(n),u)/u;return u?(e.invert=function(n,t){var e=o-t,r=K(u)*Math.sqrt(n*n+e*e);return[Math.atan2(n,e)/u,2*Math.atan(Math.pow(o/r,1/u))-Io]},e):Ne}function ke(n,t){function e(n,t){var e=u-t;return[e*Math.sin(i*n),u-e*Math.cos(i*n)]}var r=Math.cos(n),i=n===t?Math.sin(n):(r-Math.cos(t))/(t-n),u=r/i+n;return xo(i)<Uo?ce:(e.invert=function(n,t){var e=u-t;return[Math.atan2(n,e)/i,u-K(i)*Math.sqrt(n*n+e*e)]},e)}function Ne(n,t){return[n,Math.log(Math.tan(Fo/4+t/2))]}function Ee(n){var t,e=oe(n),r=e.scale,i=e.translate,u=e.clipExtent;return e.scale=function(){var n=r.apply(e,arguments);return n===e?t?e.clipExtent(null):e:n},e.translate=function(){var n=i.apply(e,arguments);return n===e?t?e.clipExtent(null):e:n},e.clipExtent=function(n){var o=u.apply(e,arguments);if(o===e){if(t=null==n){var a=Fo*r(),l=i();u([[l[0]-a,l[1]-a],[l[0]+a,l[1]+a]])}}else t&&(o=null);return o},e.clipExtent(null)}function Ae(n,t){return[Math.log(Math.tan(Fo/4+t/2)),-n]}function Ce(n){return n[0]}function ze(n){return n[1]}function Le(n){for(var t=n.length,e=[0,1],r=2,i=2;t>i;i++){for(;r>1&&Q(n[e[r-2]],n[e[r-1]],n[i])<=0;)--r;e[r++]=i}return e.slice(0,r)}function qe(n,t){return n[0]-t[0]||n[1]-t[1]}function Te(n,t,e){return(e[0]-t[0])*(n[1]-t[1])<(e[1]-t[1])*(n[0]-t[0])}function Re(n,t,e,r){var i=n[0],u=e[0],o=t[0]-i,a=r[0]-u,l=n[1],c=e[1],f=t[1]-l,s=r[1]-c,h=(a*(l-c)-s*(i-u))/(s*o-a*f);return[i+h*o,l+h*f]}function De(n){var t=n[0],e=n[n.length-1];return!(t[0]-e[0]||t[1]-e[1])}function Pe(){rr(this),this.edge=this.site=this.circle=null}function Ue(n){var t=cl.pop()||new Pe;return t.site=n,t}function je(n){Be(n),ol.remove(n),cl.push(n),rr(n)}function Fe(n){var t=n.circle,e=t.x,r=t.cy,i={x:e,y:r},u=n.P,o=n.N,a=[n];je(n);for(var l=u;l.circle&&xo(e-l.circle.x)<Uo&&xo(r-l.circle.cy)<Uo;)u=l.P,a.unshift(l),je(l),l=u;a.unshift(l),Be(l);for(var c=o;c.circle&&xo(e-c.circle.x)<Uo&&xo(r-c.circle.cy)<Uo;)o=c.N,a.push(c),je(c),c=o;a.push(c),Be(c);var f,s=a.length;for(f=1;s>f;++f)c=a[f],l=a[f-1],nr(c.edge,l.site,c.site,i);l=a[0],c=a[s-1],c.edge=Ke(l.site,c.site,null,i),$e(l),$e(c)}function He(n){for(var t,e,r,i,u=n.x,o=n.y,a=ol._;a;)if(r=Oe(a,o)-u,r>Uo)a=a.L;else{if(i=u-Ie(a,o),!(i>Uo)){r>-Uo?(t=a.P,e=a):i>-Uo?(t=a,e=a.N):t=e=a;break}if(!a.R){t=a;break}a=a.R}var l=Ue(n);if(ol.insert(t,l),t||e){if(t===e)return Be(t),e=Ue(t.site),ol.insert(l,e),l.edge=e.edge=Ke(t.site,l.site),$e(t),void $e(e);if(!e)return void(l.edge=Ke(t.site,l.site));Be(t),Be(e);var c=t.site,f=c.x,s=c.y,h=n.x-f,p=n.y-s,g=e.site,v=g.x-f,d=g.y-s,y=2*(h*d-p*v),m=h*h+p*p,M=v*v+d*d,x={x:(d*m-p*M)/y+f,y:(h*M-v*m)/y+s};nr(e.edge,c,g,x),l.edge=Ke(c,n,null,x),e.edge=Ke(n,g,null,x),$e(t),$e(e)}}function Oe(n,t){var e=n.site,r=e.x,i=e.y,u=i-t;if(!u)return r;var o=n.P;if(!o)return-(1/0);e=o.site;var a=e.x,l=e.y,c=l-t;if(!c)return a;var f=a-r,s=1/u-1/c,h=f/c;return s?(-h+Math.sqrt(h*h-2*s*(f*f/(-2*c)-l+c/2+i-u/2)))/s+r:(r+a)/2}function Ie(n,t){var e=n.N;if(e)return Oe(e,t);var r=n.site;return r.y===t?r.x:1/0}function Ye(n){this.site=n,this.edges=[]}function Ze(n){for(var t,e,r,i,u,o,a,l,c,f,s=n[0][0],h=n[1][0],p=n[0][1],g=n[1][1],v=ul,d=v.length;d--;)if(u=v[d],u&&u.prepare())for(a=u.edges,l=a.length,o=0;l>o;)f=a[o].end(),r=f.x,i=f.y,c=a[++o%l].start(),t=c.x,e=c.y,(xo(r-t)>Uo||xo(i-e)>Uo)&&(a.splice(o,0,new tr(Qe(u.site,f,xo(r-s)<Uo&&g-i>Uo?{x:s,y:xo(t-s)<Uo?e:g}:xo(i-g)<Uo&&h-r>Uo?{x:xo(e-g)<Uo?t:h,y:g}:xo(r-h)<Uo&&i-p>Uo?{x:h,y:xo(t-h)<Uo?e:p}:xo(i-p)<Uo&&r-s>Uo?{x:xo(e-p)<Uo?t:s,y:p}:null),u.site,null)),++l)}function Ve(n,t){return t.angle-n.angle}function Xe(){rr(this),this.x=this.y=this.arc=this.site=this.cy=null}function $e(n){var t=n.P,e=n.N;if(t&&e){var r=t.site,i=n.site,u=e.site;if(r!==u){var o=i.x,a=i.y,l=r.x-o,c=r.y-a,f=u.x-o,s=u.y-a,h=2*(l*s-c*f);if(!(h>=-jo)){var p=l*l+c*c,g=f*f+s*s,v=(s*p-c*g)/h,d=(l*g-f*p)/h,s=d+a,y=fl.pop()||new Xe;y.arc=n,y.site=i,y.x=v+o,y.y=s+Math.sqrt(v*v+d*d),y.cy=s,n.circle=y;for(var m=null,M=ll._;M;)if(y.y<M.y||y.y===M.y&&y.x<=M.x){if(!M.L){m=M.P;break}M=M.L}else{if(!M.R){m=M;break}M=M.R}ll.insert(m,y),m||(al=y)}}}}function Be(n){var t=n.circle;t&&(t.P||(al=t.N),ll.remove(t),fl.push(t),rr(t),n.circle=null)}function We(n){for(var t,e=il,r=Yt(n[0][0],n[0][1],n[1][0],n[1][1]),i=e.length;i--;)t=e[i],(!Je(t,n)||!r(t)||xo(t.a.x-t.b.x)<Uo&&xo(t.a.y-t.b.y)<Uo)&&(t.a=t.b=null,e.splice(i,1))}function Je(n,t){var e=n.b;if(e)return!0;var r,i,u=n.a,o=t[0][0],a=t[1][0],l=t[0][1],c=t[1][1],f=n.l,s=n.r,h=f.x,p=f.y,g=s.x,v=s.y,d=(h+g)/2,y=(p+v)/2;if(v===p){if(o>d||d>=a)return;if(h>g){if(u){if(u.y>=c)return}else u={x:d,y:l};e={x:d,y:c}}else{if(u){if(u.y<l)return}else u={x:d,y:c};e={x:d,y:l}}}else if(r=(h-g)/(v-p),i=y-r*d,-1>r||r>1)if(h>g){if(u){if(u.y>=c)return}else u={x:(l-i)/r,y:l};e={x:(c-i)/r,y:c}}else{if(u){if(u.y<l)return}else u={x:(c-i)/r,y:c};e={x:(l-i)/r,y:l}}else if(v>p){if(u){if(u.x>=a)return}else u={x:o,y:r*o+i};e={x:a,y:r*a+i}}else{if(u){if(u.x<o)return}else u={x:a,y:r*a+i};e={x:o,y:r*o+i}}return n.a=u,n.b=e,!0}function Ge(n,t){this.l=n,this.r=t,this.a=this.b=null}function Ke(n,t,e,r){var i=new Ge(n,t);return il.push(i),e&&nr(i,n,t,e),r&&nr(i,t,n,r),ul[n.i].edges.push(new tr(i,n,t)),ul[t.i].edges.push(new tr(i,t,n)),i}function Qe(n,t,e){var r=new Ge(n,null);return r.a=t,r.b=e,il.push(r),r}function nr(n,t,e,r){n.a||n.b?n.l===e?n.b=r:n.a=r:(n.a=r,n.l=t,n.r=e)}function tr(n,t,e){var r=n.a,i=n.b;this.edge=n,this.site=t,this.angle=e?Math.atan2(e.y-t.y,e.x-t.x):n.l===t?Math.atan2(i.x-r.x,r.y-i.y):Math.atan2(r.x-i.x,i.y-r.y)}function er(){this._=null}function rr(n){n.U=n.C=n.L=n.R=n.P=n.N=null}function ir(n,t){var e=t,r=t.R,i=e.U;i?i.L===e?i.L=r:i.R=r:n._=r,r.U=i,e.U=r,e.R=r.L,e.R&&(e.R.U=e),r.L=e}function ur(n,t){var e=t,r=t.L,i=e.U;i?i.L===e?i.L=r:i.R=r:n._=r,r.U=i,e.U=r,e.L=r.R,e.L&&(e.L.U=e),r.R=e}function or(n){for(;n.L;)n=n.L;return n}function ar(n,t){var e,r,i,u=n.sort(lr).pop();for(il=[],ul=new Array(n.length),ol=new er,ll=new er;;)if(i=al,u&&(!i||u.y<i.y||u.y===i.y&&u.x<i.x))u.x===e&&u.y===r||(ul[u.i]=new Ye(u),He(u),e=u.x,r=u.y),u=n.pop();else{if(!i)break;Fe(i.arc)}t&&(We(t),Ze(t));var o={cells:ul,edges:il};return ol=ll=il=ul=null,o}function lr(n,t){return t.y-n.y||t.x-n.x}function cr(n,t,e){return(n.x-e.x)*(t.y-n.y)-(n.x-t.x)*(e.y-n.y)}function fr(n){return n.x}function sr(n){return n.y}function hr(){return{leaf:!0,nodes:[],point:null,x:null,y:null}}function pr(n,t,e,r,i,u){if(!n(t,e,r,i,u)){var o=.5*(e+i),a=.5*(r+u),l=t.nodes;l[0]&&pr(n,l[0],e,r,o,a),l[1]&&pr(n,l[1],o,r,i,a),l[2]&&pr(n,l[2],e,a,o,u),l[3]&&pr(n,l[3],o,a,i,u)}}function gr(n,t,e,r,i,u,o){var a,l=1/0;return function c(n,f,s,h,p){if(!(f>u||s>o||r>h||i>p)){if(g=n.point){var g,v=t-n.x,d=e-n.y,y=v*v+d*d;if(l>y){var m=Math.sqrt(l=y);r=t-m,i=e-m,u=t+m,o=e+m,a=g}}for(var M=n.nodes,x=.5*(f+h),b=.5*(s+p),_=t>=x,w=e>=b,S=w<<1|_,k=S+4;k>S;++S)if(n=M[3&S])switch(3&S){case 0:c(n,f,s,x,b);break;case 1:c(n,x,s,h,b);break;case 2:c(n,f,b,x,p);break;case 3:c(n,x,b,h,p)}}}(n,r,i,u,o),a}function vr(n,t){n=ao.rgb(n),t=ao.rgb(t);var e=n.r,r=n.g,i=n.b,u=t.r-e,o=t.g-r,a=t.b-i;return function(n){return"#"+bn(Math.round(e+u*n))+bn(Math.round(r+o*n))+bn(Math.round(i+a*n))}}function dr(n,t){var e,r={},i={};for(e in n)e in t?r[e]=Mr(n[e],t[e]):i[e]=n[e];for(e in t)e in n||(i[e]=t[e]);return function(n){for(e in r)i[e]=r[e](n);return i}}function yr(n,t){return n=+n,t=+t,function(e){return n*(1-e)+t*e}}function mr(n,t){var e,r,i,u=hl.lastIndex=pl.lastIndex=0,o=-1,a=[],l=[];for(n+="",t+="";(e=hl.exec(n))&&(r=pl.exec(t));)(i=r.index)>u&&(i=t.slice(u,i),a[o]?a[o]+=i:a[++o]=i),(e=e[0])===(r=r[0])?a[o]?a[o]+=r:a[++o]=r:(a[++o]=null,l.push({i:o,x:yr(e,r)})),u=pl.lastIndex;return u<t.length&&(i=t.slice(u),a[o]?a[o]+=i:a[++o]=i),a.length<2?l[0]?(t=l[0].x,function(n){return t(n)+""}):function(){return t}:(t=l.length,function(n){for(var e,r=0;t>r;++r)a[(e=l[r]).i]=e.x(n);return a.join("")})}function Mr(n,t){for(var e,r=ao.interpolators.length;--r>=0&&!(e=ao.interpolators[r](n,t)););return e}function xr(n,t){var e,r=[],i=[],u=n.length,o=t.length,a=Math.min(n.length,t.length);for(e=0;a>e;++e)r.push(Mr(n[e],t[e]));for(;u>e;++e)i[e]=n[e];for(;o>e;++e)i[e]=t[e];return function(n){for(e=0;a>e;++e)i[e]=r[e](n);return i}}function br(n){return function(t){return 0>=t?0:t>=1?1:n(t)}}function _r(n){return function(t){return 1-n(1-t)}}function wr(n){return function(t){return.5*(.5>t?n(2*t):2-n(2-2*t))}}function Sr(n){return n*n}function kr(n){return n*n*n}function Nr(n){if(0>=n)return 0;if(n>=1)return 1;var t=n*n,e=t*n;return 4*(.5>n?e:3*(n-t)+e-.75)}function Er(n){return function(t){return Math.pow(t,n)}}function Ar(n){return 1-Math.cos(n*Io)}function Cr(n){return Math.pow(2,10*(n-1))}function zr(n){return 1-Math.sqrt(1-n*n)}function Lr(n,t){var e;return arguments.length<2&&(t=.45),arguments.length?e=t/Ho*Math.asin(1/n):(n=1,e=t/4),function(r){return 1+n*Math.pow(2,-10*r)*Math.sin((r-e)*Ho/t)}}function qr(n){return n||(n=1.70158),function(t){return t*t*((n+1)*t-n)}}function Tr(n){return 1/2.75>n?7.5625*n*n:2/2.75>n?7.5625*(n-=1.5/2.75)*n+.75:2.5/2.75>n?7.5625*(n-=2.25/2.75)*n+.9375:7.5625*(n-=2.625/2.75)*n+.984375}function Rr(n,t){n=ao.hcl(n),t=ao.hcl(t);var e=n.h,r=n.c,i=n.l,u=t.h-e,o=t.c-r,a=t.l-i;return isNaN(o)&&(o=0,r=isNaN(r)?t.c:r),isNaN(u)?(u=0,e=isNaN(e)?t.h:e):u>180?u-=360:-180>u&&(u+=360),function(n){return sn(e+u*n,r+o*n,i+a*n)+""}}function Dr(n,t){n=ao.hsl(n),t=ao.hsl(t);var e=n.h,r=n.s,i=n.l,u=t.h-e,o=t.s-r,a=t.l-i;return isNaN(o)&&(o=0,r=isNaN(r)?t.s:r),isNaN(u)?(u=0,e=isNaN(e)?t.h:e):u>180?u-=360:-180>u&&(u+=360),function(n){return cn(e+u*n,r+o*n,i+a*n)+""}}function Pr(n,t){n=ao.lab(n),t=ao.lab(t);var e=n.l,r=n.a,i=n.b,u=t.l-e,o=t.a-r,a=t.b-i;return function(n){return pn(e+u*n,r+o*n,i+a*n)+""}}function Ur(n,t){return t-=n,function(e){return Math.round(n+t*e)}}function jr(n){var t=[n.a,n.b],e=[n.c,n.d],r=Hr(t),i=Fr(t,e),u=Hr(Or(e,t,-i))||0;t[0]*e[1]<e[0]*t[1]&&(t[0]*=-1,t[1]*=-1,r*=-1,i*=-1),this.rotate=(r?Math.atan2(t[1],t[0]):Math.atan2(-e[0],e[1]))*Zo,this.translate=[n.e,n.f],this.scale=[r,u],this.skew=u?Math.atan2(i,u)*Zo:0}function Fr(n,t){return n[0]*t[0]+n[1]*t[1]}function Hr(n){var t=Math.sqrt(Fr(n,n));return t&&(n[0]/=t,n[1]/=t),t}function Or(n,t,e){return n[0]+=e*t[0],n[1]+=e*t[1],n}function Ir(n){return n.length?n.pop()+",":""}function Yr(n,t,e,r){if(n[0]!==t[0]||n[1]!==t[1]){var i=e.push("translate(",null,",",null,")");r.push({i:i-4,x:yr(n[0],t[0])},{i:i-2,x:yr(n[1],t[1])})}else(t[0]||t[1])&&e.push("translate("+t+")")}function Zr(n,t,e,r){n!==t?(n-t>180?t+=360:t-n>180&&(n+=360),r.push({i:e.push(Ir(e)+"rotate(",null,")")-2,x:yr(n,t)})):t&&e.push(Ir(e)+"rotate("+t+")")}function Vr(n,t,e,r){n!==t?r.push({i:e.push(Ir(e)+"skewX(",null,")")-2,x:yr(n,t)}):t&&e.push(Ir(e)+"skewX("+t+")")}function Xr(n,t,e,r){if(n[0]!==t[0]||n[1]!==t[1]){var i=e.push(Ir(e)+"scale(",null,",",null,")");r.push({i:i-4,x:yr(n[0],t[0])},{i:i-2,x:yr(n[1],t[1])})}else 1===t[0]&&1===t[1]||e.push(Ir(e)+"scale("+t+")")}function $r(n,t){var e=[],r=[];return n=ao.transform(n),t=ao.transform(t),Yr(n.translate,t.translate,e,r),Zr(n.rotate,t.rotate,e,r),Vr(n.skew,t.skew,e,r),Xr(n.scale,t.scale,e,r),n=t=null,function(n){for(var t,i=-1,u=r.length;++i<u;)e[(t=r[i]).i]=t.x(n);return e.join("")}}function Br(n,t){return t=(t-=n=+n)||1/t,function(e){return(e-n)/t}}function Wr(n,t){return t=(t-=n=+n)||1/t,function(e){return Math.max(0,Math.min(1,(e-n)/t))}}function Jr(n){for(var t=n.source,e=n.target,r=Kr(t,e),i=[t];t!==r;)t=t.parent,i.push(t);for(var u=i.length;e!==r;)i.splice(u,0,e),e=e.parent;return i}function Gr(n){for(var t=[],e=n.parent;null!=e;)t.push(n),n=e,e=e.parent;return t.push(n),t}function Kr(n,t){if(n===t)return n;for(var e=Gr(n),r=Gr(t),i=e.pop(),u=r.pop(),o=null;i===u;)o=i,i=e.pop(),u=r.pop();return o}function Qr(n){n.fixed|=2}function ni(n){n.fixed&=-7}function ti(n){n.fixed|=4,n.px=n.x,n.py=n.y}function ei(n){n.fixed&=-5}function ri(n,t,e){var r=0,i=0;if(n.charge=0,!n.leaf)for(var u,o=n.nodes,a=o.length,l=-1;++l<a;)u=o[l],null!=u&&(ri(u,t,e),n.charge+=u.charge,r+=u.charge*u.cx,i+=u.charge*u.cy);if(n.point){n.leaf||(n.point.x+=Math.random()-.5,n.point.y+=Math.random()-.5);var c=t*e[n.point.index];n.charge+=n.pointCharge=c,r+=c*n.point.x,i+=c*n.point.y}n.cx=r/n.charge,n.cy=i/n.charge}function ii(n,t){return ao.rebind(n,t,"sort","children","value"),n.nodes=n,n.links=fi,n}function ui(n,t){for(var e=[n];null!=(n=e.pop());)if(t(n),(i=n.children)&&(r=i.length))for(var r,i;--r>=0;)e.push(i[r])}function oi(n,t){for(var e=[n],r=[];null!=(n=e.pop());)if(r.push(n),(u=n.children)&&(i=u.length))for(var i,u,o=-1;++o<i;)e.push(u[o]);for(;null!=(n=r.pop());)t(n)}function ai(n){return n.children}function li(n){return n.value}function ci(n,t){return t.value-n.value}function fi(n){return ao.merge(n.map(function(n){return(n.children||[]).map(function(t){return{source:n,target:t}})}))}function si(n){return n.x}function hi(n){return n.y}function pi(n,t,e){n.y0=t,n.y=e}function gi(n){return ao.range(n.length)}function vi(n){for(var t=-1,e=n[0].length,r=[];++t<e;)r[t]=0;return r}function di(n){for(var t,e=1,r=0,i=n[0][1],u=n.length;u>e;++e)(t=n[e][1])>i&&(r=e,i=t);return r}function yi(n){return n.reduce(mi,0)}function mi(n,t){return n+t[1]}function Mi(n,t){return xi(n,Math.ceil(Math.log(t.length)/Math.LN2+1))}function xi(n,t){for(var e=-1,r=+n[0],i=(n[1]-r)/t,u=[];++e<=t;)u[e]=i*e+r;return u}function bi(n){return[ao.min(n),ao.max(n)]}function _i(n,t){return n.value-t.value}function wi(n,t){var e=n._pack_next;n._pack_next=t,t._pack_prev=n,t._pack_next=e,e._pack_prev=t}function Si(n,t){n._pack_next=t,t._pack_prev=n}function ki(n,t){var e=t.x-n.x,r=t.y-n.y,i=n.r+t.r;return.999*i*i>e*e+r*r}function Ni(n){function t(n){f=Math.min(n.x-n.r,f),s=Math.max(n.x+n.r,s),h=Math.min(n.y-n.r,h),p=Math.max(n.y+n.r,p)}if((e=n.children)&&(c=e.length)){var e,r,i,u,o,a,l,c,f=1/0,s=-(1/0),h=1/0,p=-(1/0);if(e.forEach(Ei),r=e[0],r.x=-r.r,r.y=0,t(r),c>1&&(i=e[1],i.x=i.r,i.y=0,t(i),c>2))for(u=e[2],zi(r,i,u),t(u),wi(r,u),r._pack_prev=u,wi(u,i),i=r._pack_next,o=3;c>o;o++){zi(r,i,u=e[o]);var g=0,v=1,d=1;for(a=i._pack_next;a!==i;a=a._pack_next,v++)if(ki(a,u)){g=1;break}if(1==g)for(l=r._pack_prev;l!==a._pack_prev&&!ki(l,u);l=l._pack_prev,d++);g?(d>v||v==d&&i.r<r.r?Si(r,i=a):Si(r=l,i),o--):(wi(r,u),i=u,t(u))}var y=(f+s)/2,m=(h+p)/2,M=0;for(o=0;c>o;o++)u=e[o],u.x-=y,u.y-=m,M=Math.max(M,u.r+Math.sqrt(u.x*u.x+u.y*u.y));n.r=M,e.forEach(Ai)}}function Ei(n){n._pack_next=n._pack_prev=n}function Ai(n){delete n._pack_next,delete n._pack_prev}function Ci(n,t,e,r){var i=n.children;if(n.x=t+=r*n.x,n.y=e+=r*n.y,n.r*=r,i)for(var u=-1,o=i.length;++u<o;)Ci(i[u],t,e,r)}function zi(n,t,e){var r=n.r+e.r,i=t.x-n.x,u=t.y-n.y;if(r&&(i||u)){var o=t.r+e.r,a=i*i+u*u;o*=o,r*=r;var l=.5+(r-o)/(2*a),c=Math.sqrt(Math.max(0,2*o*(r+a)-(r-=a)*r-o*o))/(2*a);e.x=n.x+l*i+c*u,e.y=n.y+l*u-c*i}else e.x=n.x+r,e.y=n.y}function Li(n,t){return n.parent==t.parent?1:2}function qi(n){var t=n.children;return t.length?t[0]:n.t}function Ti(n){var t,e=n.children;return(t=e.length)?e[t-1]:n.t}function Ri(n,t,e){var r=e/(t.i-n.i);t.c-=r,t.s+=e,n.c+=r,t.z+=e,t.m+=e}function Di(n){for(var t,e=0,r=0,i=n.children,u=i.length;--u>=0;)t=i[u],t.z+=e,t.m+=e,e+=t.s+(r+=t.c)}function Pi(n,t,e){return n.a.parent===t.parent?n.a:e}function Ui(n){return 1+ao.max(n,function(n){return n.y})}function ji(n){return n.reduce(function(n,t){return n+t.x},0)/n.length}function Fi(n){var t=n.children;return t&&t.length?Fi(t[0]):n}function Hi(n){var t,e=n.children;return e&&(t=e.length)?Hi(e[t-1]):n}function Oi(n){return{x:n.x,y:n.y,dx:n.dx,dy:n.dy}}function Ii(n,t){var e=n.x+t[3],r=n.y+t[0],i=n.dx-t[1]-t[3],u=n.dy-t[0]-t[2];return 0>i&&(e+=i/2,i=0),0>u&&(r+=u/2,u=0),{x:e,y:r,dx:i,dy:u}}function Yi(n){var t=n[0],e=n[n.length-1];return e>t?[t,e]:[e,t]}function Zi(n){return n.rangeExtent?n.rangeExtent():Yi(n.range())}function Vi(n,t,e,r){var i=e(n[0],n[1]),u=r(t[0],t[1]);return function(n){return u(i(n))}}function Xi(n,t){var e,r=0,i=n.length-1,u=n[r],o=n[i];return u>o&&(e=r,r=i,i=e,e=u,u=o,o=e),n[r]=t.floor(u),n[i]=t.ceil(o),n}function $i(n){return n?{floor:function(t){return Math.floor(t/n)*n},ceil:function(t){return Math.ceil(t/n)*n}}:Sl}function Bi(n,t,e,r){var i=[],u=[],o=0,a=Math.min(n.length,t.length)-1;for(n[a]<n[0]&&(n=n.slice().reverse(),t=t.slice().reverse());++o<=a;)i.push(e(n[o-1],n[o])),u.push(r(t[o-1],t[o]));return function(t){var e=ao.bisect(n,t,1,a)-1;return u[e](i[e](t))}}function Wi(n,t,e,r){function i(){var i=Math.min(n.length,t.length)>2?Bi:Vi,l=r?Wr:Br;return o=i(n,t,l,e),a=i(t,n,l,Mr),u}function u(n){return o(n)}var o,a;return u.invert=function(n){return a(n)},u.domain=function(t){return arguments.length?(n=t.map(Number),i()):n},u.range=function(n){return arguments.length?(t=n,i()):t},u.rangeRound=function(n){return u.range(n).interpolate(Ur)},u.clamp=function(n){return arguments.length?(r=n,i()):r},u.interpolate=function(n){return arguments.length?(e=n,i()):e},u.ticks=function(t){return Qi(n,t)},u.tickFormat=function(t,e){return nu(n,t,e)},u.nice=function(t){return Gi(n,t),i()},u.copy=function(){return Wi(n,t,e,r)},i()}function Ji(n,t){return ao.rebind(n,t,"range","rangeRound","interpolate","clamp")}function Gi(n,t){return Xi(n,$i(Ki(n,t)[2])),Xi(n,$i(Ki(n,t)[2])),n}function Ki(n,t){null==t&&(t=10);var e=Yi(n),r=e[1]-e[0],i=Math.pow(10,Math.floor(Math.log(r/t)/Math.LN10)),u=t/r*i;return.15>=u?i*=10:.35>=u?i*=5:.75>=u&&(i*=2),e[0]=Math.ceil(e[0]/i)*i,e[1]=Math.floor(e[1]/i)*i+.5*i,e[2]=i,e}function Qi(n,t){return ao.range.apply(ao,Ki(n,t))}function nu(n,t,e){var r=Ki(n,t);if(e){var i=ha.exec(e);if(i.shift(),"s"===i[8]){var u=ao.formatPrefix(Math.max(xo(r[0]),xo(r[1])));return i[7]||(i[7]="."+tu(u.scale(r[2]))),i[8]="f",e=ao.format(i.join("")),function(n){return e(u.scale(n))+u.symbol}}i[7]||(i[7]="."+eu(i[8],r)),e=i.join("")}else e=",."+tu(r[2])+"f";return ao.format(e)}function tu(n){return-Math.floor(Math.log(n)/Math.LN10+.01)}function eu(n,t){var e=tu(t[2]);return n in kl?Math.abs(e-tu(Math.max(xo(t[0]),xo(t[1]))))+ +("e"!==n):e-2*("%"===n)}function ru(n,t,e,r){function i(n){return(e?Math.log(0>n?0:n):-Math.log(n>0?0:-n))/Math.log(t)}function u(n){return e?Math.pow(t,n):-Math.pow(t,-n)}function o(t){return n(i(t))}return o.invert=function(t){return u(n.invert(t))},o.domain=function(t){return arguments.length?(e=t[0]>=0,n.domain((r=t.map(Number)).map(i)),o):r},o.base=function(e){return arguments.length?(t=+e,n.domain(r.map(i)),o):t},o.nice=function(){var t=Xi(r.map(i),e?Math:El);return n.domain(t),r=t.map(u),o},o.ticks=function(){var n=Yi(r),o=[],a=n[0],l=n[1],c=Math.floor(i(a)),f=Math.ceil(i(l)),s=t%1?2:t;if(isFinite(f-c)){if(e){for(;f>c;c++)for(var h=1;s>h;h++)o.push(u(c)*h);o.push(u(c))}else for(o.push(u(c));c++<f;)for(var h=s-1;h>0;h--)o.push(u(c)*h);for(c=0;o[c]<a;c++);for(f=o.length;o[f-1]>l;f--);o=o.slice(c,f)}return o},o.tickFormat=function(n,e){if(!arguments.length)return Nl;arguments.length<2?e=Nl:"function"!=typeof e&&(e=ao.format(e));var r=Math.max(1,t*n/o.ticks().length);return function(n){var o=n/u(Math.round(i(n)));return t-.5>o*t&&(o*=t),r>=o?e(n):""}},o.copy=function(){return ru(n.copy(),t,e,r)},Ji(o,n)}function iu(n,t,e){function r(t){return n(i(t))}var i=uu(t),u=uu(1/t);return r.invert=function(t){return u(n.invert(t))},r.domain=function(t){return arguments.length?(n.domain((e=t.map(Number)).map(i)),r):e},r.ticks=function(n){return Qi(e,n)},r.tickFormat=function(n,t){return nu(e,n,t)},r.nice=function(n){return r.domain(Gi(e,n))},r.exponent=function(o){return arguments.length?(i=uu(t=o),u=uu(1/t),n.domain(e.map(i)),r):t},r.copy=function(){return iu(n.copy(),t,e)},Ji(r,n)}function uu(n){return function(t){return 0>t?-Math.pow(-t,n):Math.pow(t,n)}}function ou(n,t){function e(e){return u[((i.get(e)||("range"===t.t?i.set(e,n.push(e)):NaN))-1)%u.length]}function r(t,e){return ao.range(n.length).map(function(n){return t+e*n})}var i,u,o;return e.domain=function(r){if(!arguments.length)return n;n=[],i=new c;for(var u,o=-1,a=r.length;++o<a;)i.has(u=r[o])||i.set(u,n.push(u));return e[t.t].apply(e,t.a)},e.range=function(n){return arguments.length?(u=n,o=0,t={t:"range",a:arguments},e):u},e.rangePoints=function(i,a){arguments.length<2&&(a=0);var l=i[0],c=i[1],f=n.length<2?(l=(l+c)/2,0):(c-l)/(n.length-1+a);return u=r(l+f*a/2,f),o=0,t={t:"rangePoints",a:arguments},e},e.rangeRoundPoints=function(i,a){arguments.length<2&&(a=0);var l=i[0],c=i[1],f=n.length<2?(l=c=Math.round((l+c)/2),0):(c-l)/(n.length-1+a)|0;return u=r(l+Math.round(f*a/2+(c-l-(n.length-1+a)*f)/2),f),o=0,t={t:"rangeRoundPoints",a:arguments},e},e.rangeBands=function(i,a,l){arguments.length<2&&(a=0),arguments.length<3&&(l=a);var c=i[1]<i[0],f=i[c-0],s=i[1-c],h=(s-f)/(n.length-a+2*l);return u=r(f+h*l,h),c&&u.reverse(),o=h*(1-a),t={t:"rangeBands",a:arguments},e},e.rangeRoundBands=function(i,a,l){arguments.length<2&&(a=0),arguments.length<3&&(l=a);var c=i[1]<i[0],f=i[c-0],s=i[1-c],h=Math.floor((s-f)/(n.length-a+2*l));return u=r(f+Math.round((s-f-(n.length-a)*h)/2),h),c&&u.reverse(),o=Math.round(h*(1-a)),t={t:"rangeRoundBands",a:arguments},e},e.rangeBand=function(){return o},e.rangeExtent=function(){return Yi(t.a[0])},e.copy=function(){return ou(n,t)},e.domain(n)}function au(n,t){function u(){var e=0,r=t.length;for(a=[];++e<r;)a[e-1]=ao.quantile(n,e/r);return o}function o(n){return isNaN(n=+n)?void 0:t[ao.bisect(a,n)]}var a;return o.domain=function(t){return arguments.length?(n=t.map(r).filter(i).sort(e),u()):n},o.range=function(n){return arguments.length?(t=n,u()):t},o.quantiles=function(){return a},o.invertExtent=function(e){return e=t.indexOf(e),0>e?[NaN,NaN]:[e>0?a[e-1]:n[0],e<a.length?a[e]:n[n.length-1]]},o.copy=function(){return au(n,t)},u()}function lu(n,t,e){function r(t){return e[Math.max(0,Math.min(o,Math.floor(u*(t-n))))]}function i(){return u=e.length/(t-n),o=e.length-1,r}var u,o;return r.domain=function(e){return arguments.length?(n=+e[0],t=+e[e.length-1],i()):[n,t]},r.range=function(n){return arguments.length?(e=n,i()):e},r.invertExtent=function(t){return t=e.indexOf(t),t=0>t?NaN:t/u+n,[t,t+1/u]},r.copy=function(){return lu(n,t,e)},i()}function cu(n,t){function e(e){return e>=e?t[ao.bisect(n,e)]:void 0}return e.domain=function(t){return arguments.length?(n=t,e):n},e.range=function(n){return arguments.length?(t=n,e):t},e.invertExtent=function(e){return e=t.indexOf(e),[n[e-1],n[e]]},e.copy=function(){return cu(n,t)},e}function fu(n){function t(n){return+n}return t.invert=t,t.domain=t.range=function(e){return arguments.length?(n=e.map(t),t):n},t.ticks=function(t){return Qi(n,t)},t.tickFormat=function(t,e){return nu(n,t,e)},t.copy=function(){return fu(n)},t}function su(){return 0}function hu(n){return n.innerRadius}function pu(n){return n.outerRadius}function gu(n){return n.startAngle}function vu(n){return n.endAngle}function du(n){return n&&n.padAngle}function yu(n,t,e,r){return(n-e)*t-(t-r)*n>0?0:1}function mu(n,t,e,r,i){var u=n[0]-t[0],o=n[1]-t[1],a=(i?r:-r)/Math.sqrt(u*u+o*o),l=a*o,c=-a*u,f=n[0]+l,s=n[1]+c,h=t[0]+l,p=t[1]+c,g=(f+h)/2,v=(s+p)/2,d=h-f,y=p-s,m=d*d+y*y,M=e-r,x=f*p-h*s,b=(0>y?-1:1)*Math.sqrt(Math.max(0,M*M*m-x*x)),_=(x*y-d*b)/m,w=(-x*d-y*b)/m,S=(x*y+d*b)/m,k=(-x*d+y*b)/m,N=_-g,E=w-v,A=S-g,C=k-v;return N*N+E*E>A*A+C*C&&(_=S,w=k),[[_-l,w-c],[_*e/M,w*e/M]]}function Mu(n){function t(t){function o(){c.push("M",u(n(f),a))}for(var l,c=[],f=[],s=-1,h=t.length,p=En(e),g=En(r);++s<h;)i.call(this,l=t[s],s)?f.push([+p.call(this,l,s),+g.call(this,l,s)]):f.length&&(o(),f=[]);return f.length&&o(),c.length?c.join(""):null}var e=Ce,r=ze,i=zt,u=xu,o=u.key,a=.7;return t.x=function(n){return arguments.length?(e=n,t):e},t.y=function(n){return arguments.length?(r=n,t):r},t.defined=function(n){return arguments.length?(i=n,t):i},t.interpolate=function(n){return arguments.length?(o="function"==typeof n?u=n:(u=Tl.get(n)||xu).key,t):o},t.tension=function(n){return arguments.length?(a=n,t):a},t}function xu(n){return n.length>1?n.join("L"):n+"Z"}function bu(n){return n.join("L")+"Z"}function _u(n){for(var t=0,e=n.length,r=n[0],i=[r[0],",",r[1]];++t<e;)i.push("H",(r[0]+(r=n[t])[0])/2,"V",r[1]);return e>1&&i.push("H",r[0]),i.join("")}function wu(n){for(var t=0,e=n.length,r=n[0],i=[r[0],",",r[1]];++t<e;)i.push("V",(r=n[t])[1],"H",r[0]);return i.join("")}function Su(n){for(var t=0,e=n.length,r=n[0],i=[r[0],",",r[1]];++t<e;)i.push("H",(r=n[t])[0],"V",r[1]);return i.join("")}function ku(n,t){return n.length<4?xu(n):n[1]+Au(n.slice(1,-1),Cu(n,t))}function Nu(n,t){return n.length<3?bu(n):n[0]+Au((n.push(n[0]),n),Cu([n[n.length-2]].concat(n,[n[1]]),t))}function Eu(n,t){return n.length<3?xu(n):n[0]+Au(n,Cu(n,t))}function Au(n,t){if(t.length<1||n.length!=t.length&&n.length!=t.length+2)return xu(n);var e=n.length!=t.length,r="",i=n[0],u=n[1],o=t[0],a=o,l=1;if(e&&(r+="Q"+(u[0]-2*o[0]/3)+","+(u[1]-2*o[1]/3)+","+u[0]+","+u[1],i=n[1],l=2),t.length>1){a=t[1],u=n[l],l++,r+="C"+(i[0]+o[0])+","+(i[1]+o[1])+","+(u[0]-a[0])+","+(u[1]-a[1])+","+u[0]+","+u[1];for(var c=2;c<t.length;c++,l++)u=n[l],a=t[c],r+="S"+(u[0]-a[0])+","+(u[1]-a[1])+","+u[0]+","+u[1]}if(e){var f=n[l];r+="Q"+(u[0]+2*a[0]/3)+","+(u[1]+2*a[1]/3)+","+f[0]+","+f[1]}return r}function Cu(n,t){for(var e,r=[],i=(1-t)/2,u=n[0],o=n[1],a=1,l=n.length;++a<l;)e=u,u=o,o=n[a],r.push([i*(o[0]-e[0]),i*(o[1]-e[1])]);return r}function zu(n){if(n.length<3)return xu(n);var t=1,e=n.length,r=n[0],i=r[0],u=r[1],o=[i,i,i,(r=n[1])[0]],a=[u,u,u,r[1]],l=[i,",",u,"L",Ru(Pl,o),",",Ru(Pl,a)];for(n.push(n[e-1]);++t<=e;)r=n[t],o.shift(),o.push(r[0]),a.shift(),a.push(r[1]),Du(l,o,a);return n.pop(),l.push("L",r),l.join("")}function Lu(n){if(n.length<4)return xu(n);for(var t,e=[],r=-1,i=n.length,u=[0],o=[0];++r<3;)t=n[r],u.push(t[0]),o.push(t[1]);for(e.push(Ru(Pl,u)+","+Ru(Pl,o)),--r;++r<i;)t=n[r],u.shift(),u.push(t[0]),o.shift(),o.push(t[1]),Du(e,u,o);return e.join("")}function qu(n){for(var t,e,r=-1,i=n.length,u=i+4,o=[],a=[];++r<4;)e=n[r%i],o.push(e[0]),a.push(e[1]);for(t=[Ru(Pl,o),",",Ru(Pl,a)],--r;++r<u;)e=n[r%i],o.shift(),o.push(e[0]),a.shift(),a.push(e[1]),Du(t,o,a);return t.join("")}function Tu(n,t){var e=n.length-1;if(e)for(var r,i,u=n[0][0],o=n[0][1],a=n[e][0]-u,l=n[e][1]-o,c=-1;++c<=e;)r=n[c],i=c/e,r[0]=t*r[0]+(1-t)*(u+i*a),r[1]=t*r[1]+(1-t)*(o+i*l);return zu(n)}function Ru(n,t){return n[0]*t[0]+n[1]*t[1]+n[2]*t[2]+n[3]*t[3]}function Du(n,t,e){n.push("C",Ru(Rl,t),",",Ru(Rl,e),",",Ru(Dl,t),",",Ru(Dl,e),",",Ru(Pl,t),",",Ru(Pl,e))}function Pu(n,t){return(t[1]-n[1])/(t[0]-n[0])}function Uu(n){for(var t=0,e=n.length-1,r=[],i=n[0],u=n[1],o=r[0]=Pu(i,u);++t<e;)r[t]=(o+(o=Pu(i=u,u=n[t+1])))/2;return r[t]=o,r}function ju(n){for(var t,e,r,i,u=[],o=Uu(n),a=-1,l=n.length-1;++a<l;)t=Pu(n[a],n[a+1]),xo(t)<Uo?o[a]=o[a+1]=0:(e=o[a]/t,r=o[a+1]/t,i=e*e+r*r,i>9&&(i=3*t/Math.sqrt(i),o[a]=i*e,o[a+1]=i*r));for(a=-1;++a<=l;)i=(n[Math.min(l,a+1)][0]-n[Math.max(0,a-1)][0])/(6*(1+o[a]*o[a])),u.push([i||0,o[a]*i||0]);return u}function Fu(n){return n.length<3?xu(n):n[0]+Au(n,ju(n))}function Hu(n){for(var t,e,r,i=-1,u=n.length;++i<u;)t=n[i],e=t[0],r=t[1]-Io,t[0]=e*Math.cos(r),t[1]=e*Math.sin(r);return n}function Ou(n){function t(t){function l(){v.push("M",a(n(y),s),f,c(n(d.reverse()),s),"Z")}for(var h,p,g,v=[],d=[],y=[],m=-1,M=t.length,x=En(e),b=En(i),_=e===r?function(){
return p}:En(r),w=i===u?function(){return g}:En(u);++m<M;)o.call(this,h=t[m],m)?(d.push([p=+x.call(this,h,m),g=+b.call(this,h,m)]),y.push([+_.call(this,h,m),+w.call(this,h,m)])):d.length&&(l(),d=[],y=[]);return d.length&&l(),v.length?v.join(""):null}var e=Ce,r=Ce,i=0,u=ze,o=zt,a=xu,l=a.key,c=a,f="L",s=.7;return t.x=function(n){return arguments.length?(e=r=n,t):r},t.x0=function(n){return arguments.length?(e=n,t):e},t.x1=function(n){return arguments.length?(r=n,t):r},t.y=function(n){return arguments.length?(i=u=n,t):u},t.y0=function(n){return arguments.length?(i=n,t):i},t.y1=function(n){return arguments.length?(u=n,t):u},t.defined=function(n){return arguments.length?(o=n,t):o},t.interpolate=function(n){return arguments.length?(l="function"==typeof n?a=n:(a=Tl.get(n)||xu).key,c=a.reverse||a,f=a.closed?"M":"L",t):l},t.tension=function(n){return arguments.length?(s=n,t):s},t}function Iu(n){return n.radius}function Yu(n){return[n.x,n.y]}function Zu(n){return function(){var t=n.apply(this,arguments),e=t[0],r=t[1]-Io;return[e*Math.cos(r),e*Math.sin(r)]}}function Vu(){return 64}function Xu(){return"circle"}function $u(n){var t=Math.sqrt(n/Fo);return"M0,"+t+"A"+t+","+t+" 0 1,1 0,"+-t+"A"+t+","+t+" 0 1,1 0,"+t+"Z"}function Bu(n){return function(){var t,e,r;(t=this[n])&&(r=t[e=t.active])&&(r.timer.c=null,r.timer.t=NaN,--t.count?delete t[e]:delete this[n],t.active+=.5,r.event&&r.event.interrupt.call(this,this.__data__,r.index))}}function Wu(n,t,e){return ko(n,Yl),n.namespace=t,n.id=e,n}function Ju(n,t,e,r){var i=n.id,u=n.namespace;return Y(n,"function"==typeof e?function(n,o,a){n[u][i].tween.set(t,r(e.call(n,n.__data__,o,a)))}:(e=r(e),function(n){n[u][i].tween.set(t,e)}))}function Gu(n){return null==n&&(n=""),function(){this.textContent=n}}function Ku(n){return null==n?"__transition__":"__transition_"+n+"__"}function Qu(n,t,e,r,i){function u(n){var t=v.delay;return f.t=t+l,n>=t?o(n-t):void(f.c=o)}function o(e){var i=g.active,u=g[i];u&&(u.timer.c=null,u.timer.t=NaN,--g.count,delete g[i],u.event&&u.event.interrupt.call(n,n.__data__,u.index));for(var o in g)if(r>+o){var c=g[o];c.timer.c=null,c.timer.t=NaN,--g.count,delete g[o]}f.c=a,qn(function(){return f.c&&a(e||1)&&(f.c=null,f.t=NaN),1},0,l),g.active=r,v.event&&v.event.start.call(n,n.__data__,t),p=[],v.tween.forEach(function(e,r){(r=r.call(n,n.__data__,t))&&p.push(r)}),h=v.ease,s=v.duration}function a(i){for(var u=i/s,o=h(u),a=p.length;a>0;)p[--a].call(n,o);return u>=1?(v.event&&v.event.end.call(n,n.__data__,t),--g.count?delete g[r]:delete n[e],1):void 0}var l,f,s,h,p,g=n[e]||(n[e]={active:0,count:0}),v=g[r];v||(l=i.time,f=qn(u,0,l),v=g[r]={tween:new c,time:l,timer:f,delay:i.delay,duration:i.duration,ease:i.ease,index:t},i=null,++g.count)}function no(n,t,e){n.attr("transform",function(n){var r=t(n);return"translate("+(isFinite(r)?r:e(n))+",0)"})}function to(n,t,e){n.attr("transform",function(n){var r=t(n);return"translate(0,"+(isFinite(r)?r:e(n))+")"})}function eo(n){return n.toISOString()}function ro(n,t,e){function r(t){return n(t)}function i(n,e){var r=n[1]-n[0],i=r/e,u=ao.bisect(Kl,i);return u==Kl.length?[t.year,Ki(n.map(function(n){return n/31536e6}),e)[2]]:u?t[i/Kl[u-1]<Kl[u]/i?u-1:u]:[tc,Ki(n,e)[2]]}return r.invert=function(t){return io(n.invert(t))},r.domain=function(t){return arguments.length?(n.domain(t),r):n.domain().map(io)},r.nice=function(n,t){function e(e){return!isNaN(e)&&!n.range(e,io(+e+1),t).length}var u=r.domain(),o=Yi(u),a=null==n?i(o,10):"number"==typeof n&&i(o,n);return a&&(n=a[0],t=a[1]),r.domain(Xi(u,t>1?{floor:function(t){for(;e(t=n.floor(t));)t=io(t-1);return t},ceil:function(t){for(;e(t=n.ceil(t));)t=io(+t+1);return t}}:n))},r.ticks=function(n,t){var e=Yi(r.domain()),u=null==n?i(e,10):"number"==typeof n?i(e,n):!n.range&&[{range:n},t];return u&&(n=u[0],t=u[1]),n.range(e[0],io(+e[1]+1),1>t?1:t)},r.tickFormat=function(){return e},r.copy=function(){return ro(n.copy(),t,e)},Ji(r,n)}function io(n){return new Date(n)}function uo(n){return JSON.parse(n.responseText)}function oo(n){var t=fo.createRange();return t.selectNode(fo.body),t.createContextualFragment(n.responseText)}var ao={version:"3.5.17"},lo=[].slice,co=function(n){return lo.call(n)},fo=this.document;if(fo)try{co(fo.documentElement.childNodes)[0].nodeType}catch(so){co=function(n){for(var t=n.length,e=new Array(t);t--;)e[t]=n[t];return e}}if(Date.now||(Date.now=function(){return+new Date}),fo)try{fo.createElement("DIV").style.setProperty("opacity",0,"")}catch(ho){var po=this.Element.prototype,go=po.setAttribute,vo=po.setAttributeNS,yo=this.CSSStyleDeclaration.prototype,mo=yo.setProperty;po.setAttribute=function(n,t){go.call(this,n,t+"")},po.setAttributeNS=function(n,t,e){vo.call(this,n,t,e+"")},yo.setProperty=function(n,t,e){mo.call(this,n,t+"",e)}}ao.ascending=e,ao.descending=function(n,t){return n>t?-1:t>n?1:t>=n?0:NaN},ao.min=function(n,t){var e,r,i=-1,u=n.length;if(1===arguments.length){for(;++i<u;)if(null!=(r=n[i])&&r>=r){e=r;break}for(;++i<u;)null!=(r=n[i])&&e>r&&(e=r)}else{for(;++i<u;)if(null!=(r=t.call(n,n[i],i))&&r>=r){e=r;break}for(;++i<u;)null!=(r=t.call(n,n[i],i))&&e>r&&(e=r)}return e},ao.max=function(n,t){var e,r,i=-1,u=n.length;if(1===arguments.length){for(;++i<u;)if(null!=(r=n[i])&&r>=r){e=r;break}for(;++i<u;)null!=(r=n[i])&&r>e&&(e=r)}else{for(;++i<u;)if(null!=(r=t.call(n,n[i],i))&&r>=r){e=r;break}for(;++i<u;)null!=(r=t.call(n,n[i],i))&&r>e&&(e=r)}return e},ao.extent=function(n,t){var e,r,i,u=-1,o=n.length;if(1===arguments.length){for(;++u<o;)if(null!=(r=n[u])&&r>=r){e=i=r;break}for(;++u<o;)null!=(r=n[u])&&(e>r&&(e=r),r>i&&(i=r))}else{for(;++u<o;)if(null!=(r=t.call(n,n[u],u))&&r>=r){e=i=r;break}for(;++u<o;)null!=(r=t.call(n,n[u],u))&&(e>r&&(e=r),r>i&&(i=r))}return[e,i]},ao.sum=function(n,t){var e,r=0,u=n.length,o=-1;if(1===arguments.length)for(;++o<u;)i(e=+n[o])&&(r+=e);else for(;++o<u;)i(e=+t.call(n,n[o],o))&&(r+=e);return r},ao.mean=function(n,t){var e,u=0,o=n.length,a=-1,l=o;if(1===arguments.length)for(;++a<o;)i(e=r(n[a]))?u+=e:--l;else for(;++a<o;)i(e=r(t.call(n,n[a],a)))?u+=e:--l;return l?u/l:void 0},ao.quantile=function(n,t){var e=(n.length-1)*t+1,r=Math.floor(e),i=+n[r-1],u=e-r;return u?i+u*(n[r]-i):i},ao.median=function(n,t){var u,o=[],a=n.length,l=-1;if(1===arguments.length)for(;++l<a;)i(u=r(n[l]))&&o.push(u);else for(;++l<a;)i(u=r(t.call(n,n[l],l)))&&o.push(u);return o.length?ao.quantile(o.sort(e),.5):void 0},ao.variance=function(n,t){var e,u,o=n.length,a=0,l=0,c=-1,f=0;if(1===arguments.length)for(;++c<o;)i(e=r(n[c]))&&(u=e-a,a+=u/++f,l+=u*(e-a));else for(;++c<o;)i(e=r(t.call(n,n[c],c)))&&(u=e-a,a+=u/++f,l+=u*(e-a));return f>1?l/(f-1):void 0},ao.deviation=function(){var n=ao.variance.apply(this,arguments);return n?Math.sqrt(n):n};var Mo=u(e);ao.bisectLeft=Mo.left,ao.bisect=ao.bisectRight=Mo.right,ao.bisector=function(n){return u(1===n.length?function(t,r){return e(n(t),r)}:n)},ao.shuffle=function(n,t,e){(u=arguments.length)<3&&(e=n.length,2>u&&(t=0));for(var r,i,u=e-t;u;)i=Math.random()*u--|0,r=n[u+t],n[u+t]=n[i+t],n[i+t]=r;return n},ao.permute=function(n,t){for(var e=t.length,r=new Array(e);e--;)r[e]=n[t[e]];return r},ao.pairs=function(n){for(var t,e=0,r=n.length-1,i=n[0],u=new Array(0>r?0:r);r>e;)u[e]=[t=i,i=n[++e]];return u},ao.transpose=function(n){if(!(i=n.length))return[];for(var t=-1,e=ao.min(n,o),r=new Array(e);++t<e;)for(var i,u=-1,a=r[t]=new Array(i);++u<i;)a[u]=n[u][t];return r},ao.zip=function(){return ao.transpose(arguments)},ao.keys=function(n){var t=[];for(var e in n)t.push(e);return t},ao.values=function(n){var t=[];for(var e in n)t.push(n[e]);return t},ao.entries=function(n){var t=[];for(var e in n)t.push({key:e,value:n[e]});return t},ao.merge=function(n){for(var t,e,r,i=n.length,u=-1,o=0;++u<i;)o+=n[u].length;for(e=new Array(o);--i>=0;)for(r=n[i],t=r.length;--t>=0;)e[--o]=r[t];return e};var xo=Math.abs;ao.range=function(n,t,e){if(arguments.length<3&&(e=1,arguments.length<2&&(t=n,n=0)),(t-n)/e===1/0)throw new Error("infinite range");var r,i=[],u=a(xo(e)),o=-1;if(n*=u,t*=u,e*=u,0>e)for(;(r=n+e*++o)>t;)i.push(r/u);else for(;(r=n+e*++o)<t;)i.push(r/u);return i},ao.map=function(n,t){var e=new c;if(n instanceof c)n.forEach(function(n,t){e.set(n,t)});else if(Array.isArray(n)){var r,i=-1,u=n.length;if(1===arguments.length)for(;++i<u;)e.set(i,n[i]);else for(;++i<u;)e.set(t.call(n,r=n[i],i),r)}else for(var o in n)e.set(o,n[o]);return e};var bo="__proto__",_o="\x00";l(c,{has:h,get:function(n){return this._[f(n)]},set:function(n,t){return this._[f(n)]=t},remove:p,keys:g,values:function(){var n=[];for(var t in this._)n.push(this._[t]);return n},entries:function(){var n=[];for(var t in this._)n.push({key:s(t),value:this._[t]});return n},size:v,empty:d,forEach:function(n){for(var t in this._)n.call(this,s(t),this._[t])}}),ao.nest=function(){function n(t,o,a){if(a>=u.length)return r?r.call(i,o):e?o.sort(e):o;for(var l,f,s,h,p=-1,g=o.length,v=u[a++],d=new c;++p<g;)(h=d.get(l=v(f=o[p])))?h.push(f):d.set(l,[f]);return t?(f=t(),s=function(e,r){f.set(e,n(t,r,a))}):(f={},s=function(e,r){f[e]=n(t,r,a)}),d.forEach(s),f}function t(n,e){if(e>=u.length)return n;var r=[],i=o[e++];return n.forEach(function(n,i){r.push({key:n,values:t(i,e)})}),i?r.sort(function(n,t){return i(n.key,t.key)}):r}var e,r,i={},u=[],o=[];return i.map=function(t,e){return n(e,t,0)},i.entries=function(e){return t(n(ao.map,e,0),0)},i.key=function(n){return u.push(n),i},i.sortKeys=function(n){return o[u.length-1]=n,i},i.sortValues=function(n){return e=n,i},i.rollup=function(n){return r=n,i},i},ao.set=function(n){var t=new y;if(n)for(var e=0,r=n.length;r>e;++e)t.add(n[e]);return t},l(y,{has:h,add:function(n){return this._[f(n+="")]=!0,n},remove:p,values:g,size:v,empty:d,forEach:function(n){for(var t in this._)n.call(this,s(t))}}),ao.behavior={},ao.rebind=function(n,t){for(var e,r=1,i=arguments.length;++r<i;)n[e=arguments[r]]=M(n,t,t[e]);return n};var wo=["webkit","ms","moz","Moz","o","O"];ao.dispatch=function(){for(var n=new _,t=-1,e=arguments.length;++t<e;)n[arguments[t]]=w(n);return n},_.prototype.on=function(n,t){var e=n.indexOf("."),r="";if(e>=0&&(r=n.slice(e+1),n=n.slice(0,e)),n)return arguments.length<2?this[n].on(r):this[n].on(r,t);if(2===arguments.length){if(null==t)for(n in this)this.hasOwnProperty(n)&&this[n].on(r,null);return this}},ao.event=null,ao.requote=function(n){return n.replace(So,"\\$&")};var So=/[\\\^\$\*\+\?\|\[\]\(\)\.\{\}]/g,ko={}.__proto__?function(n,t){n.__proto__=t}:function(n,t){for(var e in t)n[e]=t[e]},No=function(n,t){return t.querySelector(n)},Eo=function(n,t){return t.querySelectorAll(n)},Ao=function(n,t){var e=n.matches||n[x(n,"matchesSelector")];return(Ao=function(n,t){return e.call(n,t)})(n,t)};"function"==typeof Sizzle&&(No=function(n,t){return Sizzle(n,t)[0]||null},Eo=Sizzle,Ao=Sizzle.matchesSelector),ao.selection=function(){return ao.select(fo.documentElement)};var Co=ao.selection.prototype=[];Co.select=function(n){var t,e,r,i,u=[];n=A(n);for(var o=-1,a=this.length;++o<a;){u.push(t=[]),t.parentNode=(r=this[o]).parentNode;for(var l=-1,c=r.length;++l<c;)(i=r[l])?(t.push(e=n.call(i,i.__data__,l,o)),e&&"__data__"in i&&(e.__data__=i.__data__)):t.push(null)}return E(u)},Co.selectAll=function(n){var t,e,r=[];n=C(n);for(var i=-1,u=this.length;++i<u;)for(var o=this[i],a=-1,l=o.length;++a<l;)(e=o[a])&&(r.push(t=co(n.call(e,e.__data__,a,i))),t.parentNode=e);return E(r)};var zo="http://www.w3.org/1999/xhtml",Lo={svg:"http://www.w3.org/2000/svg",xhtml:zo,xlink:"http://www.w3.org/1999/xlink",xml:"http://www.w3.org/XML/1998/namespace",xmlns:"http://www.w3.org/2000/xmlns/"};ao.ns={prefix:Lo,qualify:function(n){var t=n.indexOf(":"),e=n;return t>=0&&"xmlns"!==(e=n.slice(0,t))&&(n=n.slice(t+1)),Lo.hasOwnProperty(e)?{space:Lo[e],local:n}:n}},Co.attr=function(n,t){if(arguments.length<2){if("string"==typeof n){var e=this.node();return n=ao.ns.qualify(n),n.local?e.getAttributeNS(n.space,n.local):e.getAttribute(n)}for(t in n)this.each(z(t,n[t]));return this}return this.each(z(n,t))},Co.classed=function(n,t){if(arguments.length<2){if("string"==typeof n){var e=this.node(),r=(n=T(n)).length,i=-1;if(t=e.classList){for(;++i<r;)if(!t.contains(n[i]))return!1}else for(t=e.getAttribute("class");++i<r;)if(!q(n[i]).test(t))return!1;return!0}for(t in n)this.each(R(t,n[t]));return this}return this.each(R(n,t))},Co.style=function(n,e,r){var i=arguments.length;if(3>i){if("string"!=typeof n){2>i&&(e="");for(r in n)this.each(P(r,n[r],e));return this}if(2>i){var u=this.node();return t(u).getComputedStyle(u,null).getPropertyValue(n)}r=""}return this.each(P(n,e,r))},Co.property=function(n,t){if(arguments.length<2){if("string"==typeof n)return this.node()[n];for(t in n)this.each(U(t,n[t]));return this}return this.each(U(n,t))},Co.text=function(n){return arguments.length?this.each("function"==typeof n?function(){var t=n.apply(this,arguments);this.textContent=null==t?"":t}:null==n?function(){this.textContent=""}:function(){this.textContent=n}):this.node().textContent},Co.html=function(n){return arguments.length?this.each("function"==typeof n?function(){var t=n.apply(this,arguments);this.innerHTML=null==t?"":t}:null==n?function(){this.innerHTML=""}:function(){this.innerHTML=n}):this.node().innerHTML},Co.append=function(n){return n=j(n),this.select(function(){return this.appendChild(n.apply(this,arguments))})},Co.insert=function(n,t){return n=j(n),t=A(t),this.select(function(){return this.insertBefore(n.apply(this,arguments),t.apply(this,arguments)||null)})},Co.remove=function(){return this.each(F)},Co.data=function(n,t){function e(n,e){var r,i,u,o=n.length,s=e.length,h=Math.min(o,s),p=new Array(s),g=new Array(s),v=new Array(o);if(t){var d,y=new c,m=new Array(o);for(r=-1;++r<o;)(i=n[r])&&(y.has(d=t.call(i,i.__data__,r))?v[r]=i:y.set(d,i),m[r]=d);for(r=-1;++r<s;)(i=y.get(d=t.call(e,u=e[r],r)))?i!==!0&&(p[r]=i,i.__data__=u):g[r]=H(u),y.set(d,!0);for(r=-1;++r<o;)r in m&&y.get(m[r])!==!0&&(v[r]=n[r])}else{for(r=-1;++r<h;)i=n[r],u=e[r],i?(i.__data__=u,p[r]=i):g[r]=H(u);for(;s>r;++r)g[r]=H(e[r]);for(;o>r;++r)v[r]=n[r]}g.update=p,g.parentNode=p.parentNode=v.parentNode=n.parentNode,a.push(g),l.push(p),f.push(v)}var r,i,u=-1,o=this.length;if(!arguments.length){for(n=new Array(o=(r=this[0]).length);++u<o;)(i=r[u])&&(n[u]=i.__data__);return n}var a=Z([]),l=E([]),f=E([]);if("function"==typeof n)for(;++u<o;)e(r=this[u],n.call(r,r.parentNode.__data__,u));else for(;++u<o;)e(r=this[u],n);return l.enter=function(){return a},l.exit=function(){return f},l},Co.datum=function(n){return arguments.length?this.property("__data__",n):this.property("__data__")},Co.filter=function(n){var t,e,r,i=[];"function"!=typeof n&&(n=O(n));for(var u=0,o=this.length;o>u;u++){i.push(t=[]),t.parentNode=(e=this[u]).parentNode;for(var a=0,l=e.length;l>a;a++)(r=e[a])&&n.call(r,r.__data__,a,u)&&t.push(r)}return E(i)},Co.order=function(){for(var n=-1,t=this.length;++n<t;)for(var e,r=this[n],i=r.length-1,u=r[i];--i>=0;)(e=r[i])&&(u&&u!==e.nextSibling&&u.parentNode.insertBefore(e,u),u=e);return this},Co.sort=function(n){n=I.apply(this,arguments);for(var t=-1,e=this.length;++t<e;)this[t].sort(n);return this.order()},Co.each=function(n){return Y(this,function(t,e,r){n.call(t,t.__data__,e,r)})},Co.call=function(n){var t=co(arguments);return n.apply(t[0]=this,t),this},Co.empty=function(){return!this.node()},Co.node=function(){for(var n=0,t=this.length;t>n;n++)for(var e=this[n],r=0,i=e.length;i>r;r++){var u=e[r];if(u)return u}return null},Co.size=function(){var n=0;return Y(this,function(){++n}),n};var qo=[];ao.selection.enter=Z,ao.selection.enter.prototype=qo,qo.append=Co.append,qo.empty=Co.empty,qo.node=Co.node,qo.call=Co.call,qo.size=Co.size,qo.select=function(n){for(var t,e,r,i,u,o=[],a=-1,l=this.length;++a<l;){r=(i=this[a]).update,o.push(t=[]),t.parentNode=i.parentNode;for(var c=-1,f=i.length;++c<f;)(u=i[c])?(t.push(r[c]=e=n.call(i.parentNode,u.__data__,c,a)),e.__data__=u.__data__):t.push(null)}return E(o)},qo.insert=function(n,t){return arguments.length<2&&(t=V(this)),Co.insert.call(this,n,t)},ao.select=function(t){var e;return"string"==typeof t?(e=[No(t,fo)],e.parentNode=fo.documentElement):(e=[t],e.parentNode=n(t)),E([e])},ao.selectAll=function(n){var t;return"string"==typeof n?(t=co(Eo(n,fo)),t.parentNode=fo.documentElement):(t=co(n),t.parentNode=null),E([t])},Co.on=function(n,t,e){var r=arguments.length;if(3>r){if("string"!=typeof n){2>r&&(t=!1);for(e in n)this.each(X(e,n[e],t));return this}if(2>r)return(r=this.node()["__on"+n])&&r._;e=!1}return this.each(X(n,t,e))};var To=ao.map({mouseenter:"mouseover",mouseleave:"mouseout"});fo&&To.forEach(function(n){"on"+n in fo&&To.remove(n)});var Ro,Do=0;ao.mouse=function(n){return J(n,k())};var Po=this.navigator&&/WebKit/.test(this.navigator.userAgent)?-1:0;ao.touch=function(n,t,e){if(arguments.length<3&&(e=t,t=k().changedTouches),t)for(var r,i=0,u=t.length;u>i;++i)if((r=t[i]).identifier===e)return J(n,r)},ao.behavior.drag=function(){function n(){this.on("mousedown.drag",u).on("touchstart.drag",o)}function e(n,t,e,u,o){return function(){function a(){var n,e,r=t(h,v);r&&(n=r[0]-M[0],e=r[1]-M[1],g|=n|e,M=r,p({type:"drag",x:r[0]+c[0],y:r[1]+c[1],dx:n,dy:e}))}function l(){t(h,v)&&(y.on(u+d,null).on(o+d,null),m(g),p({type:"dragend"}))}var c,f=this,s=ao.event.target.correspondingElement||ao.event.target,h=f.parentNode,p=r.of(f,arguments),g=0,v=n(),d=".drag"+(null==v?"":"-"+v),y=ao.select(e(s)).on(u+d,a).on(o+d,l),m=W(s),M=t(h,v);i?(c=i.apply(f,arguments),c=[c.x-M[0],c.y-M[1]]):c=[0,0],p({type:"dragstart"})}}var r=N(n,"drag","dragstart","dragend"),i=null,u=e(b,ao.mouse,t,"mousemove","mouseup"),o=e(G,ao.touch,m,"touchmove","touchend");return n.origin=function(t){return arguments.length?(i=t,n):i},ao.rebind(n,r,"on")},ao.touches=function(n,t){return arguments.length<2&&(t=k().touches),t?co(t).map(function(t){var e=J(n,t);return e.identifier=t.identifier,e}):[]};var Uo=1e-6,jo=Uo*Uo,Fo=Math.PI,Ho=2*Fo,Oo=Ho-Uo,Io=Fo/2,Yo=Fo/180,Zo=180/Fo,Vo=Math.SQRT2,Xo=2,$o=4;ao.interpolateZoom=function(n,t){var e,r,i=n[0],u=n[1],o=n[2],a=t[0],l=t[1],c=t[2],f=a-i,s=l-u,h=f*f+s*s;if(jo>h)r=Math.log(c/o)/Vo,e=function(n){return[i+n*f,u+n*s,o*Math.exp(Vo*n*r)]};else{var p=Math.sqrt(h),g=(c*c-o*o+$o*h)/(2*o*Xo*p),v=(c*c-o*o-$o*h)/(2*c*Xo*p),d=Math.log(Math.sqrt(g*g+1)-g),y=Math.log(Math.sqrt(v*v+1)-v);r=(y-d)/Vo,e=function(n){var t=n*r,e=rn(d),a=o/(Xo*p)*(e*un(Vo*t+d)-en(d));return[i+a*f,u+a*s,o*e/rn(Vo*t+d)]}}return e.duration=1e3*r,e},ao.behavior.zoom=function(){function n(n){n.on(L,s).on(Wo+".zoom",p).on("dblclick.zoom",g).on(R,h)}function e(n){return[(n[0]-k.x)/k.k,(n[1]-k.y)/k.k]}function r(n){return[n[0]*k.k+k.x,n[1]*k.k+k.y]}function i(n){k.k=Math.max(A[0],Math.min(A[1],n))}function u(n,t){t=r(t),k.x+=n[0]-t[0],k.y+=n[1]-t[1]}function o(t,e,r,o){t.__chart__={x:k.x,y:k.y,k:k.k},i(Math.pow(2,o)),u(d=e,r),t=ao.select(t),C>0&&(t=t.transition().duration(C)),t.call(n.event)}function a(){b&&b.domain(x.range().map(function(n){return(n-k.x)/k.k}).map(x.invert)),w&&w.domain(_.range().map(function(n){return(n-k.y)/k.k}).map(_.invert))}function l(n){z++||n({type:"zoomstart"})}function c(n){a(),n({type:"zoom",scale:k.k,translate:[k.x,k.y]})}function f(n){--z||(n({type:"zoomend"}),d=null)}function s(){function n(){a=1,u(ao.mouse(i),h),c(o)}function r(){s.on(q,null).on(T,null),p(a),f(o)}var i=this,o=D.of(i,arguments),a=0,s=ao.select(t(i)).on(q,n).on(T,r),h=e(ao.mouse(i)),p=W(i);Il.call(i),l(o)}function h(){function n(){var n=ao.touches(g);return p=k.k,n.forEach(function(n){n.identifier in d&&(d[n.identifier]=e(n))}),n}function t(){var t=ao.event.target;ao.select(t).on(x,r).on(b,a),_.push(t);for(var e=ao.event.changedTouches,i=0,u=e.length;u>i;++i)d[e[i].identifier]=null;var l=n(),c=Date.now();if(1===l.length){if(500>c-M){var f=l[0];o(g,f,d[f.identifier],Math.floor(Math.log(k.k)/Math.LN2)+1),S()}M=c}else if(l.length>1){var f=l[0],s=l[1],h=f[0]-s[0],p=f[1]-s[1];y=h*h+p*p}}function r(){var n,t,e,r,o=ao.touches(g);Il.call(g);for(var a=0,l=o.length;l>a;++a,r=null)if(e=o[a],r=d[e.identifier]){if(t)break;n=e,t=r}if(r){var f=(f=e[0]-n[0])*f+(f=e[1]-n[1])*f,s=y&&Math.sqrt(f/y);n=[(n[0]+e[0])/2,(n[1]+e[1])/2],t=[(t[0]+r[0])/2,(t[1]+r[1])/2],i(s*p)}M=null,u(n,t),c(v)}function a(){if(ao.event.touches.length){for(var t=ao.event.changedTouches,e=0,r=t.length;r>e;++e)delete d[t[e].identifier];for(var i in d)return void n()}ao.selectAll(_).on(m,null),w.on(L,s).on(R,h),N(),f(v)}var p,g=this,v=D.of(g,arguments),d={},y=0,m=".zoom-"+ao.event.changedTouches[0].identifier,x="touchmove"+m,b="touchend"+m,_=[],w=ao.select(g),N=W(g);t(),l(v),w.on(L,null).on(R,t)}function p(){var n=D.of(this,arguments);m?clearTimeout(m):(Il.call(this),v=e(d=y||ao.mouse(this)),l(n)),m=setTimeout(function(){m=null,f(n)},50),S(),i(Math.pow(2,.002*Bo())*k.k),u(d,v),c(n)}function g(){var n=ao.mouse(this),t=Math.log(k.k)/Math.LN2;o(this,n,e(n),ao.event.shiftKey?Math.ceil(t)-1:Math.floor(t)+1)}var v,d,y,m,M,x,b,_,w,k={x:0,y:0,k:1},E=[960,500],A=Jo,C=250,z=0,L="mousedown.zoom",q="mousemove.zoom",T="mouseup.zoom",R="touchstart.zoom",D=N(n,"zoomstart","zoom","zoomend");return Wo||(Wo="onwheel"in fo?(Bo=function(){return-ao.event.deltaY*(ao.event.deltaMode?120:1)},"wheel"):"onmousewheel"in fo?(Bo=function(){return ao.event.wheelDelta},"mousewheel"):(Bo=function(){return-ao.event.detail},"MozMousePixelScroll")),n.event=function(n){n.each(function(){var n=D.of(this,arguments),t=k;Hl?ao.select(this).transition().each("start.zoom",function(){k=this.__chart__||{x:0,y:0,k:1},l(n)}).tween("zoom:zoom",function(){var e=E[0],r=E[1],i=d?d[0]:e/2,u=d?d[1]:r/2,o=ao.interpolateZoom([(i-k.x)/k.k,(u-k.y)/k.k,e/k.k],[(i-t.x)/t.k,(u-t.y)/t.k,e/t.k]);return function(t){var r=o(t),a=e/r[2];this.__chart__=k={x:i-r[0]*a,y:u-r[1]*a,k:a},c(n)}}).each("interrupt.zoom",function(){f(n)}).each("end.zoom",function(){f(n)}):(this.__chart__=k,l(n),c(n),f(n))})},n.translate=function(t){return arguments.length?(k={x:+t[0],y:+t[1],k:k.k},a(),n):[k.x,k.y]},n.scale=function(t){return arguments.length?(k={x:k.x,y:k.y,k:null},i(+t),a(),n):k.k},n.scaleExtent=function(t){return arguments.length?(A=null==t?Jo:[+t[0],+t[1]],n):A},n.center=function(t){return arguments.length?(y=t&&[+t[0],+t[1]],n):y},n.size=function(t){return arguments.length?(E=t&&[+t[0],+t[1]],n):E},n.duration=function(t){return arguments.length?(C=+t,n):C},n.x=function(t){return arguments.length?(b=t,x=t.copy(),k={x:0,y:0,k:1},n):b},n.y=function(t){return arguments.length?(w=t,_=t.copy(),k={x:0,y:0,k:1},n):w},ao.rebind(n,D,"on")};var Bo,Wo,Jo=[0,1/0];ao.color=an,an.prototype.toString=function(){return this.rgb()+""},ao.hsl=ln;var Go=ln.prototype=new an;Go.brighter=function(n){return n=Math.pow(.7,arguments.length?n:1),new ln(this.h,this.s,this.l/n)},Go.darker=function(n){return n=Math.pow(.7,arguments.length?n:1),new ln(this.h,this.s,n*this.l)},Go.rgb=function(){return cn(this.h,this.s,this.l)},ao.hcl=fn;var Ko=fn.prototype=new an;Ko.brighter=function(n){return new fn(this.h,this.c,Math.min(100,this.l+Qo*(arguments.length?n:1)))},Ko.darker=function(n){return new fn(this.h,this.c,Math.max(0,this.l-Qo*(arguments.length?n:1)))},Ko.rgb=function(){return sn(this.h,this.c,this.l).rgb()},ao.lab=hn;var Qo=18,na=.95047,ta=1,ea=1.08883,ra=hn.prototype=new an;ra.brighter=function(n){return new hn(Math.min(100,this.l+Qo*(arguments.length?n:1)),this.a,this.b)},ra.darker=function(n){return new hn(Math.max(0,this.l-Qo*(arguments.length?n:1)),this.a,this.b)},ra.rgb=function(){return pn(this.l,this.a,this.b)},ao.rgb=mn;var ia=mn.prototype=new an;ia.brighter=function(n){n=Math.pow(.7,arguments.length?n:1);var t=this.r,e=this.g,r=this.b,i=30;return t||e||r?(t&&i>t&&(t=i),e&&i>e&&(e=i),r&&i>r&&(r=i),new mn(Math.min(255,t/n),Math.min(255,e/n),Math.min(255,r/n))):new mn(i,i,i)},ia.darker=function(n){return n=Math.pow(.7,arguments.length?n:1),new mn(n*this.r,n*this.g,n*this.b)},ia.hsl=function(){return wn(this.r,this.g,this.b)},ia.toString=function(){return"#"+bn(this.r)+bn(this.g)+bn(this.b)};var ua=ao.map({aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074});ua.forEach(function(n,t){ua.set(n,Mn(t))}),ao.functor=En,ao.xhr=An(m),ao.dsv=function(n,t){function e(n,e,u){arguments.length<3&&(u=e,e=null);var o=Cn(n,t,null==e?r:i(e),u);return o.row=function(n){return arguments.length?o.response(null==(e=n)?r:i(n)):e},o}function r(n){return e.parse(n.responseText)}function i(n){return function(t){return e.parse(t.responseText,n)}}function u(t){return t.map(o).join(n)}function o(n){return a.test(n)?'"'+n.replace(/\"/g,'""')+'"':n}var a=new RegExp('["'+n+"\n]"),l=n.charCodeAt(0);return e.parse=function(n,t){var r;return e.parseRows(n,function(n,e){if(r)return r(n,e-1);var i=new Function("d","return {"+n.map(function(n,t){return JSON.stringify(n)+": d["+t+"]"}).join(",")+"}");r=t?function(n,e){return t(i(n),e)}:i})},e.parseRows=function(n,t){function e(){if(f>=c)return o;if(i)return i=!1,u;var t=f;if(34===n.charCodeAt(t)){for(var e=t;e++<c;)if(34===n.charCodeAt(e)){if(34!==n.charCodeAt(e+1))break;++e}f=e+2;var r=n.charCodeAt(e+1);return 13===r?(i=!0,10===n.charCodeAt(e+2)&&++f):10===r&&(i=!0),n.slice(t+1,e).replace(/""/g,'"')}for(;c>f;){var r=n.charCodeAt(f++),a=1;if(10===r)i=!0;else if(13===r)i=!0,10===n.charCodeAt(f)&&(++f,++a);else if(r!==l)continue;return n.slice(t,f-a)}return n.slice(t)}for(var r,i,u={},o={},a=[],c=n.length,f=0,s=0;(r=e())!==o;){for(var h=[];r!==u&&r!==o;)h.push(r),r=e();t&&null==(h=t(h,s++))||a.push(h)}return a},e.format=function(t){if(Array.isArray(t[0]))return e.formatRows(t);var r=new y,i=[];return t.forEach(function(n){for(var t in n)r.has(t)||i.push(r.add(t))}),[i.map(o).join(n)].concat(t.map(function(t){return i.map(function(n){return o(t[n])}).join(n)})).join("\n")},e.formatRows=function(n){return n.map(u).join("\n")},e},ao.csv=ao.dsv(",","text/csv"),ao.tsv=ao.dsv("	","text/tab-separated-values");var oa,aa,la,ca,fa=this[x(this,"requestAnimationFrame")]||function(n){setTimeout(n,17)};ao.timer=function(){qn.apply(this,arguments)},ao.timer.flush=function(){Rn(),Dn()},ao.round=function(n,t){return t?Math.round(n*(t=Math.pow(10,t)))/t:Math.round(n)};var sa=["y","z","a","f","p","n","\xb5","m","","k","M","G","T","P","E","Z","Y"].map(Un);ao.formatPrefix=function(n,t){var e=0;return(n=+n)&&(0>n&&(n*=-1),t&&(n=ao.round(n,Pn(n,t))),e=1+Math.floor(1e-12+Math.log(n)/Math.LN10),e=Math.max(-24,Math.min(24,3*Math.floor((e-1)/3)))),sa[8+e/3]};var ha=/(?:([^{])?([<>=^]))?([+\- ])?([$#])?(0)?(\d+)?(,)?(\.-?\d+)?([a-z%])?/i,pa=ao.map({b:function(n){return n.toString(2)},c:function(n){return String.fromCharCode(n)},o:function(n){return n.toString(8)},x:function(n){return n.toString(16)},X:function(n){return n.toString(16).toUpperCase()},g:function(n,t){return n.toPrecision(t)},e:function(n,t){return n.toExponential(t)},f:function(n,t){return n.toFixed(t)},r:function(n,t){return(n=ao.round(n,Pn(n,t))).toFixed(Math.max(0,Math.min(20,Pn(n*(1+1e-15),t))))}}),ga=ao.time={},va=Date;Hn.prototype={getDate:function(){return this._.getUTCDate()},getDay:function(){return this._.getUTCDay()},getFullYear:function(){return this._.getUTCFullYear()},getHours:function(){return this._.getUTCHours()},getMilliseconds:function(){return this._.getUTCMilliseconds()},getMinutes:function(){return this._.getUTCMinutes()},getMonth:function(){return this._.getUTCMonth()},getSeconds:function(){return this._.getUTCSeconds()},getTime:function(){return this._.getTime()},getTimezoneOffset:function(){return 0},valueOf:function(){return this._.valueOf()},setDate:function(){da.setUTCDate.apply(this._,arguments)},setDay:function(){da.setUTCDay.apply(this._,arguments)},setFullYear:function(){da.setUTCFullYear.apply(this._,arguments)},setHours:function(){da.setUTCHours.apply(this._,arguments)},setMilliseconds:function(){da.setUTCMilliseconds.apply(this._,arguments)},setMinutes:function(){da.setUTCMinutes.apply(this._,arguments)},setMonth:function(){da.setUTCMonth.apply(this._,arguments)},setSeconds:function(){da.setUTCSeconds.apply(this._,arguments)},setTime:function(){da.setTime.apply(this._,arguments)}};var da=Date.prototype;ga.year=On(function(n){return n=ga.day(n),n.setMonth(0,1),n},function(n,t){n.setFullYear(n.getFullYear()+t)},function(n){return n.getFullYear()}),ga.years=ga.year.range,ga.years.utc=ga.year.utc.range,ga.day=On(function(n){var t=new va(2e3,0);return t.setFullYear(n.getFullYear(),n.getMonth(),n.getDate()),t},function(n,t){n.setDate(n.getDate()+t)},function(n){return n.getDate()-1}),ga.days=ga.day.range,ga.days.utc=ga.day.utc.range,ga.dayOfYear=function(n){var t=ga.year(n);return Math.floor((n-t-6e4*(n.getTimezoneOffset()-t.getTimezoneOffset()))/864e5)},["sunday","monday","tuesday","wednesday","thursday","friday","saturday"].forEach(function(n,t){t=7-t;var e=ga[n]=On(function(n){return(n=ga.day(n)).setDate(n.getDate()-(n.getDay()+t)%7),n},function(n,t){n.setDate(n.getDate()+7*Math.floor(t))},function(n){var e=ga.year(n).getDay();return Math.floor((ga.dayOfYear(n)+(e+t)%7)/7)-(e!==t)});ga[n+"s"]=e.range,ga[n+"s"].utc=e.utc.range,ga[n+"OfYear"]=function(n){var e=ga.year(n).getDay();return Math.floor((ga.dayOfYear(n)+(e+t)%7)/7)}}),ga.week=ga.sunday,ga.weeks=ga.sunday.range,ga.weeks.utc=ga.sunday.utc.range,ga.weekOfYear=ga.sundayOfYear;var ya={"-":"",_:" ",0:"0"},ma=/^\s*\d+/,Ma=/^%/;ao.locale=function(n){return{numberFormat:jn(n),timeFormat:Yn(n)}};var xa=ao.locale({decimal:".",thousands:",",grouping:[3],currency:["$",""],dateTime:"%a %b %e %X %Y",date:"%m/%d/%Y",time:"%H:%M:%S",periods:["AM","PM"],days:["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"],
shortDays:["Sun","Mon","Tue","Wed","Thu","Fri","Sat"],months:["January","February","March","April","May","June","July","August","September","October","November","December"],shortMonths:["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]});ao.format=xa.numberFormat,ao.geo={},ft.prototype={s:0,t:0,add:function(n){st(n,this.t,ba),st(ba.s,this.s,this),this.s?this.t+=ba.t:this.s=ba.t},reset:function(){this.s=this.t=0},valueOf:function(){return this.s}};var ba=new ft;ao.geo.stream=function(n,t){n&&_a.hasOwnProperty(n.type)?_a[n.type](n,t):ht(n,t)};var _a={Feature:function(n,t){ht(n.geometry,t)},FeatureCollection:function(n,t){for(var e=n.features,r=-1,i=e.length;++r<i;)ht(e[r].geometry,t)}},wa={Sphere:function(n,t){t.sphere()},Point:function(n,t){n=n.coordinates,t.point(n[0],n[1],n[2])},MultiPoint:function(n,t){for(var e=n.coordinates,r=-1,i=e.length;++r<i;)n=e[r],t.point(n[0],n[1],n[2])},LineString:function(n,t){pt(n.coordinates,t,0)},MultiLineString:function(n,t){for(var e=n.coordinates,r=-1,i=e.length;++r<i;)pt(e[r],t,0)},Polygon:function(n,t){gt(n.coordinates,t)},MultiPolygon:function(n,t){for(var e=n.coordinates,r=-1,i=e.length;++r<i;)gt(e[r],t)},GeometryCollection:function(n,t){for(var e=n.geometries,r=-1,i=e.length;++r<i;)ht(e[r],t)}};ao.geo.area=function(n){return Sa=0,ao.geo.stream(n,Na),Sa};var Sa,ka=new ft,Na={sphere:function(){Sa+=4*Fo},point:b,lineStart:b,lineEnd:b,polygonStart:function(){ka.reset(),Na.lineStart=vt},polygonEnd:function(){var n=2*ka;Sa+=0>n?4*Fo+n:n,Na.lineStart=Na.lineEnd=Na.point=b}};ao.geo.bounds=function(){function n(n,t){M.push(x=[f=n,h=n]),s>t&&(s=t),t>p&&(p=t)}function t(t,e){var r=dt([t*Yo,e*Yo]);if(y){var i=mt(y,r),u=[i[1],-i[0],0],o=mt(u,i);bt(o),o=_t(o);var l=t-g,c=l>0?1:-1,v=o[0]*Zo*c,d=xo(l)>180;if(d^(v>c*g&&c*t>v)){var m=o[1]*Zo;m>p&&(p=m)}else if(v=(v+360)%360-180,d^(v>c*g&&c*t>v)){var m=-o[1]*Zo;s>m&&(s=m)}else s>e&&(s=e),e>p&&(p=e);d?g>t?a(f,t)>a(f,h)&&(h=t):a(t,h)>a(f,h)&&(f=t):h>=f?(f>t&&(f=t),t>h&&(h=t)):t>g?a(f,t)>a(f,h)&&(h=t):a(t,h)>a(f,h)&&(f=t)}else n(t,e);y=r,g=t}function e(){b.point=t}function r(){x[0]=f,x[1]=h,b.point=n,y=null}function i(n,e){if(y){var r=n-g;m+=xo(r)>180?r+(r>0?360:-360):r}else v=n,d=e;Na.point(n,e),t(n,e)}function u(){Na.lineStart()}function o(){i(v,d),Na.lineEnd(),xo(m)>Uo&&(f=-(h=180)),x[0]=f,x[1]=h,y=null}function a(n,t){return(t-=n)<0?t+360:t}function l(n,t){return n[0]-t[0]}function c(n,t){return t[0]<=t[1]?t[0]<=n&&n<=t[1]:n<t[0]||t[1]<n}var f,s,h,p,g,v,d,y,m,M,x,b={point:n,lineStart:e,lineEnd:r,polygonStart:function(){b.point=i,b.lineStart=u,b.lineEnd=o,m=0,Na.polygonStart()},polygonEnd:function(){Na.polygonEnd(),b.point=n,b.lineStart=e,b.lineEnd=r,0>ka?(f=-(h=180),s=-(p=90)):m>Uo?p=90:-Uo>m&&(s=-90),x[0]=f,x[1]=h}};return function(n){p=h=-(f=s=1/0),M=[],ao.geo.stream(n,b);var t=M.length;if(t){M.sort(l);for(var e,r=1,i=M[0],u=[i];t>r;++r)e=M[r],c(e[0],i)||c(e[1],i)?(a(i[0],e[1])>a(i[0],i[1])&&(i[1]=e[1]),a(e[0],i[1])>a(i[0],i[1])&&(i[0]=e[0])):u.push(i=e);for(var o,e,g=-(1/0),t=u.length-1,r=0,i=u[t];t>=r;i=e,++r)e=u[r],(o=a(i[1],e[0]))>g&&(g=o,f=e[0],h=i[1])}return M=x=null,f===1/0||s===1/0?[[NaN,NaN],[NaN,NaN]]:[[f,s],[h,p]]}}(),ao.geo.centroid=function(n){Ea=Aa=Ca=za=La=qa=Ta=Ra=Da=Pa=Ua=0,ao.geo.stream(n,ja);var t=Da,e=Pa,r=Ua,i=t*t+e*e+r*r;return jo>i&&(t=qa,e=Ta,r=Ra,Uo>Aa&&(t=Ca,e=za,r=La),i=t*t+e*e+r*r,jo>i)?[NaN,NaN]:[Math.atan2(e,t)*Zo,tn(r/Math.sqrt(i))*Zo]};var Ea,Aa,Ca,za,La,qa,Ta,Ra,Da,Pa,Ua,ja={sphere:b,point:St,lineStart:Nt,lineEnd:Et,polygonStart:function(){ja.lineStart=At},polygonEnd:function(){ja.lineStart=Nt}},Fa=Rt(zt,jt,Ht,[-Fo,-Fo/2]),Ha=1e9;ao.geo.clipExtent=function(){var n,t,e,r,i,u,o={stream:function(n){return i&&(i.valid=!1),i=u(n),i.valid=!0,i},extent:function(a){return arguments.length?(u=Zt(n=+a[0][0],t=+a[0][1],e=+a[1][0],r=+a[1][1]),i&&(i.valid=!1,i=null),o):[[n,t],[e,r]]}};return o.extent([[0,0],[960,500]])},(ao.geo.conicEqualArea=function(){return Vt(Xt)}).raw=Xt,ao.geo.albers=function(){return ao.geo.conicEqualArea().rotate([96,0]).center([-.6,38.7]).parallels([29.5,45.5]).scale(1070)},ao.geo.albersUsa=function(){function n(n){var u=n[0],o=n[1];return t=null,e(u,o),t||(r(u,o),t)||i(u,o),t}var t,e,r,i,u=ao.geo.albers(),o=ao.geo.conicEqualArea().rotate([154,0]).center([-2,58.5]).parallels([55,65]),a=ao.geo.conicEqualArea().rotate([157,0]).center([-3,19.9]).parallels([8,18]),l={point:function(n,e){t=[n,e]}};return n.invert=function(n){var t=u.scale(),e=u.translate(),r=(n[0]-e[0])/t,i=(n[1]-e[1])/t;return(i>=.12&&.234>i&&r>=-.425&&-.214>r?o:i>=.166&&.234>i&&r>=-.214&&-.115>r?a:u).invert(n)},n.stream=function(n){var t=u.stream(n),e=o.stream(n),r=a.stream(n);return{point:function(n,i){t.point(n,i),e.point(n,i),r.point(n,i)},sphere:function(){t.sphere(),e.sphere(),r.sphere()},lineStart:function(){t.lineStart(),e.lineStart(),r.lineStart()},lineEnd:function(){t.lineEnd(),e.lineEnd(),r.lineEnd()},polygonStart:function(){t.polygonStart(),e.polygonStart(),r.polygonStart()},polygonEnd:function(){t.polygonEnd(),e.polygonEnd(),r.polygonEnd()}}},n.precision=function(t){return arguments.length?(u.precision(t),o.precision(t),a.precision(t),n):u.precision()},n.scale=function(t){return arguments.length?(u.scale(t),o.scale(.35*t),a.scale(t),n.translate(u.translate())):u.scale()},n.translate=function(t){if(!arguments.length)return u.translate();var c=u.scale(),f=+t[0],s=+t[1];return e=u.translate(t).clipExtent([[f-.455*c,s-.238*c],[f+.455*c,s+.238*c]]).stream(l).point,r=o.translate([f-.307*c,s+.201*c]).clipExtent([[f-.425*c+Uo,s+.12*c+Uo],[f-.214*c-Uo,s+.234*c-Uo]]).stream(l).point,i=a.translate([f-.205*c,s+.212*c]).clipExtent([[f-.214*c+Uo,s+.166*c+Uo],[f-.115*c-Uo,s+.234*c-Uo]]).stream(l).point,n},n.scale(1070)};var Oa,Ia,Ya,Za,Va,Xa,$a={point:b,lineStart:b,lineEnd:b,polygonStart:function(){Ia=0,$a.lineStart=$t},polygonEnd:function(){$a.lineStart=$a.lineEnd=$a.point=b,Oa+=xo(Ia/2)}},Ba={point:Bt,lineStart:b,lineEnd:b,polygonStart:b,polygonEnd:b},Wa={point:Gt,lineStart:Kt,lineEnd:Qt,polygonStart:function(){Wa.lineStart=ne},polygonEnd:function(){Wa.point=Gt,Wa.lineStart=Kt,Wa.lineEnd=Qt}};ao.geo.path=function(){function n(n){return n&&("function"==typeof a&&u.pointRadius(+a.apply(this,arguments)),o&&o.valid||(o=i(u)),ao.geo.stream(n,o)),u.result()}function t(){return o=null,n}var e,r,i,u,o,a=4.5;return n.area=function(n){return Oa=0,ao.geo.stream(n,i($a)),Oa},n.centroid=function(n){return Ca=za=La=qa=Ta=Ra=Da=Pa=Ua=0,ao.geo.stream(n,i(Wa)),Ua?[Da/Ua,Pa/Ua]:Ra?[qa/Ra,Ta/Ra]:La?[Ca/La,za/La]:[NaN,NaN]},n.bounds=function(n){return Va=Xa=-(Ya=Za=1/0),ao.geo.stream(n,i(Ba)),[[Ya,Za],[Va,Xa]]},n.projection=function(n){return arguments.length?(i=(e=n)?n.stream||re(n):m,t()):e},n.context=function(n){return arguments.length?(u=null==(r=n)?new Wt:new te(n),"function"!=typeof a&&u.pointRadius(a),t()):r},n.pointRadius=function(t){return arguments.length?(a="function"==typeof t?t:(u.pointRadius(+t),+t),n):a},n.projection(ao.geo.albersUsa()).context(null)},ao.geo.transform=function(n){return{stream:function(t){var e=new ie(t);for(var r in n)e[r]=n[r];return e}}},ie.prototype={point:function(n,t){this.stream.point(n,t)},sphere:function(){this.stream.sphere()},lineStart:function(){this.stream.lineStart()},lineEnd:function(){this.stream.lineEnd()},polygonStart:function(){this.stream.polygonStart()},polygonEnd:function(){this.stream.polygonEnd()}},ao.geo.projection=oe,ao.geo.projectionMutator=ae,(ao.geo.equirectangular=function(){return oe(ce)}).raw=ce.invert=ce,ao.geo.rotation=function(n){function t(t){return t=n(t[0]*Yo,t[1]*Yo),t[0]*=Zo,t[1]*=Zo,t}return n=se(n[0]%360*Yo,n[1]*Yo,n.length>2?n[2]*Yo:0),t.invert=function(t){return t=n.invert(t[0]*Yo,t[1]*Yo),t[0]*=Zo,t[1]*=Zo,t},t},fe.invert=ce,ao.geo.circle=function(){function n(){var n="function"==typeof r?r.apply(this,arguments):r,t=se(-n[0]*Yo,-n[1]*Yo,0).invert,i=[];return e(null,null,1,{point:function(n,e){i.push(n=t(n,e)),n[0]*=Zo,n[1]*=Zo}}),{type:"Polygon",coordinates:[i]}}var t,e,r=[0,0],i=6;return n.origin=function(t){return arguments.length?(r=t,n):r},n.angle=function(r){return arguments.length?(e=ve((t=+r)*Yo,i*Yo),n):t},n.precision=function(r){return arguments.length?(e=ve(t*Yo,(i=+r)*Yo),n):i},n.angle(90)},ao.geo.distance=function(n,t){var e,r=(t[0]-n[0])*Yo,i=n[1]*Yo,u=t[1]*Yo,o=Math.sin(r),a=Math.cos(r),l=Math.sin(i),c=Math.cos(i),f=Math.sin(u),s=Math.cos(u);return Math.atan2(Math.sqrt((e=s*o)*e+(e=c*f-l*s*a)*e),l*f+c*s*a)},ao.geo.graticule=function(){function n(){return{type:"MultiLineString",coordinates:t()}}function t(){return ao.range(Math.ceil(u/d)*d,i,d).map(h).concat(ao.range(Math.ceil(c/y)*y,l,y).map(p)).concat(ao.range(Math.ceil(r/g)*g,e,g).filter(function(n){return xo(n%d)>Uo}).map(f)).concat(ao.range(Math.ceil(a/v)*v,o,v).filter(function(n){return xo(n%y)>Uo}).map(s))}var e,r,i,u,o,a,l,c,f,s,h,p,g=10,v=g,d=90,y=360,m=2.5;return n.lines=function(){return t().map(function(n){return{type:"LineString",coordinates:n}})},n.outline=function(){return{type:"Polygon",coordinates:[h(u).concat(p(l).slice(1),h(i).reverse().slice(1),p(c).reverse().slice(1))]}},n.extent=function(t){return arguments.length?n.majorExtent(t).minorExtent(t):n.minorExtent()},n.majorExtent=function(t){return arguments.length?(u=+t[0][0],i=+t[1][0],c=+t[0][1],l=+t[1][1],u>i&&(t=u,u=i,i=t),c>l&&(t=c,c=l,l=t),n.precision(m)):[[u,c],[i,l]]},n.minorExtent=function(t){return arguments.length?(r=+t[0][0],e=+t[1][0],a=+t[0][1],o=+t[1][1],r>e&&(t=r,r=e,e=t),a>o&&(t=a,a=o,o=t),n.precision(m)):[[r,a],[e,o]]},n.step=function(t){return arguments.length?n.majorStep(t).minorStep(t):n.minorStep()},n.majorStep=function(t){return arguments.length?(d=+t[0],y=+t[1],n):[d,y]},n.minorStep=function(t){return arguments.length?(g=+t[0],v=+t[1],n):[g,v]},n.precision=function(t){return arguments.length?(m=+t,f=ye(a,o,90),s=me(r,e,m),h=ye(c,l,90),p=me(u,i,m),n):m},n.majorExtent([[-180,-90+Uo],[180,90-Uo]]).minorExtent([[-180,-80-Uo],[180,80+Uo]])},ao.geo.greatArc=function(){function n(){return{type:"LineString",coordinates:[t||r.apply(this,arguments),e||i.apply(this,arguments)]}}var t,e,r=Me,i=xe;return n.distance=function(){return ao.geo.distance(t||r.apply(this,arguments),e||i.apply(this,arguments))},n.source=function(e){return arguments.length?(r=e,t="function"==typeof e?null:e,n):r},n.target=function(t){return arguments.length?(i=t,e="function"==typeof t?null:t,n):i},n.precision=function(){return arguments.length?n:0},n},ao.geo.interpolate=function(n,t){return be(n[0]*Yo,n[1]*Yo,t[0]*Yo,t[1]*Yo)},ao.geo.length=function(n){return Ja=0,ao.geo.stream(n,Ga),Ja};var Ja,Ga={sphere:b,point:b,lineStart:_e,lineEnd:b,polygonStart:b,polygonEnd:b},Ka=we(function(n){return Math.sqrt(2/(1+n))},function(n){return 2*Math.asin(n/2)});(ao.geo.azimuthalEqualArea=function(){return oe(Ka)}).raw=Ka;var Qa=we(function(n){var t=Math.acos(n);return t&&t/Math.sin(t)},m);(ao.geo.azimuthalEquidistant=function(){return oe(Qa)}).raw=Qa,(ao.geo.conicConformal=function(){return Vt(Se)}).raw=Se,(ao.geo.conicEquidistant=function(){return Vt(ke)}).raw=ke;var nl=we(function(n){return 1/n},Math.atan);(ao.geo.gnomonic=function(){return oe(nl)}).raw=nl,Ne.invert=function(n,t){return[n,2*Math.atan(Math.exp(t))-Io]},(ao.geo.mercator=function(){return Ee(Ne)}).raw=Ne;var tl=we(function(){return 1},Math.asin);(ao.geo.orthographic=function(){return oe(tl)}).raw=tl;var el=we(function(n){return 1/(1+n)},function(n){return 2*Math.atan(n)});(ao.geo.stereographic=function(){return oe(el)}).raw=el,Ae.invert=function(n,t){return[-t,2*Math.atan(Math.exp(n))-Io]},(ao.geo.transverseMercator=function(){var n=Ee(Ae),t=n.center,e=n.rotate;return n.center=function(n){return n?t([-n[1],n[0]]):(n=t(),[n[1],-n[0]])},n.rotate=function(n){return n?e([n[0],n[1],n.length>2?n[2]+90:90]):(n=e(),[n[0],n[1],n[2]-90])},e([0,0,90])}).raw=Ae,ao.geom={},ao.geom.hull=function(n){function t(n){if(n.length<3)return[];var t,i=En(e),u=En(r),o=n.length,a=[],l=[];for(t=0;o>t;t++)a.push([+i.call(this,n[t],t),+u.call(this,n[t],t),t]);for(a.sort(qe),t=0;o>t;t++)l.push([a[t][0],-a[t][1]]);var c=Le(a),f=Le(l),s=f[0]===c[0],h=f[f.length-1]===c[c.length-1],p=[];for(t=c.length-1;t>=0;--t)p.push(n[a[c[t]][2]]);for(t=+s;t<f.length-h;++t)p.push(n[a[f[t]][2]]);return p}var e=Ce,r=ze;return arguments.length?t(n):(t.x=function(n){return arguments.length?(e=n,t):e},t.y=function(n){return arguments.length?(r=n,t):r},t)},ao.geom.polygon=function(n){return ko(n,rl),n};var rl=ao.geom.polygon.prototype=[];rl.area=function(){for(var n,t=-1,e=this.length,r=this[e-1],i=0;++t<e;)n=r,r=this[t],i+=n[1]*r[0]-n[0]*r[1];return.5*i},rl.centroid=function(n){var t,e,r=-1,i=this.length,u=0,o=0,a=this[i-1];for(arguments.length||(n=-1/(6*this.area()));++r<i;)t=a,a=this[r],e=t[0]*a[1]-a[0]*t[1],u+=(t[0]+a[0])*e,o+=(t[1]+a[1])*e;return[u*n,o*n]},rl.clip=function(n){for(var t,e,r,i,u,o,a=De(n),l=-1,c=this.length-De(this),f=this[c-1];++l<c;){for(t=n.slice(),n.length=0,i=this[l],u=t[(r=t.length-a)-1],e=-1;++e<r;)o=t[e],Te(o,f,i)?(Te(u,f,i)||n.push(Re(u,o,f,i)),n.push(o)):Te(u,f,i)&&n.push(Re(u,o,f,i)),u=o;a&&n.push(n[0]),f=i}return n};var il,ul,ol,al,ll,cl=[],fl=[];Ye.prototype.prepare=function(){for(var n,t=this.edges,e=t.length;e--;)n=t[e].edge,n.b&&n.a||t.splice(e,1);return t.sort(Ve),t.length},tr.prototype={start:function(){return this.edge.l===this.site?this.edge.a:this.edge.b},end:function(){return this.edge.l===this.site?this.edge.b:this.edge.a}},er.prototype={insert:function(n,t){var e,r,i;if(n){if(t.P=n,t.N=n.N,n.N&&(n.N.P=t),n.N=t,n.R){for(n=n.R;n.L;)n=n.L;n.L=t}else n.R=t;e=n}else this._?(n=or(this._),t.P=null,t.N=n,n.P=n.L=t,e=n):(t.P=t.N=null,this._=t,e=null);for(t.L=t.R=null,t.U=e,t.C=!0,n=t;e&&e.C;)r=e.U,e===r.L?(i=r.R,i&&i.C?(e.C=i.C=!1,r.C=!0,n=r):(n===e.R&&(ir(this,e),n=e,e=n.U),e.C=!1,r.C=!0,ur(this,r))):(i=r.L,i&&i.C?(e.C=i.C=!1,r.C=!0,n=r):(n===e.L&&(ur(this,e),n=e,e=n.U),e.C=!1,r.C=!0,ir(this,r))),e=n.U;this._.C=!1},remove:function(n){n.N&&(n.N.P=n.P),n.P&&(n.P.N=n.N),n.N=n.P=null;var t,e,r,i=n.U,u=n.L,o=n.R;if(e=u?o?or(o):u:o,i?i.L===n?i.L=e:i.R=e:this._=e,u&&o?(r=e.C,e.C=n.C,e.L=u,u.U=e,e!==o?(i=e.U,e.U=n.U,n=e.R,i.L=n,e.R=o,o.U=e):(e.U=i,i=e,n=e.R)):(r=n.C,n=e),n&&(n.U=i),!r){if(n&&n.C)return void(n.C=!1);do{if(n===this._)break;if(n===i.L){if(t=i.R,t.C&&(t.C=!1,i.C=!0,ir(this,i),t=i.R),t.L&&t.L.C||t.R&&t.R.C){t.R&&t.R.C||(t.L.C=!1,t.C=!0,ur(this,t),t=i.R),t.C=i.C,i.C=t.R.C=!1,ir(this,i),n=this._;break}}else if(t=i.L,t.C&&(t.C=!1,i.C=!0,ur(this,i),t=i.L),t.L&&t.L.C||t.R&&t.R.C){t.L&&t.L.C||(t.R.C=!1,t.C=!0,ir(this,t),t=i.L),t.C=i.C,i.C=t.L.C=!1,ur(this,i),n=this._;break}t.C=!0,n=i,i=i.U}while(!n.C);n&&(n.C=!1)}}},ao.geom.voronoi=function(n){function t(n){var t=new Array(n.length),r=a[0][0],i=a[0][1],u=a[1][0],o=a[1][1];return ar(e(n),a).cells.forEach(function(e,a){var l=e.edges,c=e.site,f=t[a]=l.length?l.map(function(n){var t=n.start();return[t.x,t.y]}):c.x>=r&&c.x<=u&&c.y>=i&&c.y<=o?[[r,o],[u,o],[u,i],[r,i]]:[];f.point=n[a]}),t}function e(n){return n.map(function(n,t){return{x:Math.round(u(n,t)/Uo)*Uo,y:Math.round(o(n,t)/Uo)*Uo,i:t}})}var r=Ce,i=ze,u=r,o=i,a=sl;return n?t(n):(t.links=function(n){return ar(e(n)).edges.filter(function(n){return n.l&&n.r}).map(function(t){return{source:n[t.l.i],target:n[t.r.i]}})},t.triangles=function(n){var t=[];return ar(e(n)).cells.forEach(function(e,r){for(var i,u,o=e.site,a=e.edges.sort(Ve),l=-1,c=a.length,f=a[c-1].edge,s=f.l===o?f.r:f.l;++l<c;)i=f,u=s,f=a[l].edge,s=f.l===o?f.r:f.l,r<u.i&&r<s.i&&cr(o,u,s)<0&&t.push([n[r],n[u.i],n[s.i]])}),t},t.x=function(n){return arguments.length?(u=En(r=n),t):r},t.y=function(n){return arguments.length?(o=En(i=n),t):i},t.clipExtent=function(n){return arguments.length?(a=null==n?sl:n,t):a===sl?null:a},t.size=function(n){return arguments.length?t.clipExtent(n&&[[0,0],n]):a===sl?null:a&&a[1]},t)};var sl=[[-1e6,-1e6],[1e6,1e6]];ao.geom.delaunay=function(n){return ao.geom.voronoi().triangles(n)},ao.geom.quadtree=function(n,t,e,r,i){function u(n){function u(n,t,e,r,i,u,o,a){if(!isNaN(e)&&!isNaN(r))if(n.leaf){var l=n.x,f=n.y;if(null!=l)if(xo(l-e)+xo(f-r)<.01)c(n,t,e,r,i,u,o,a);else{var s=n.point;n.x=n.y=n.point=null,c(n,s,l,f,i,u,o,a),c(n,t,e,r,i,u,o,a)}else n.x=e,n.y=r,n.point=t}else c(n,t,e,r,i,u,o,a)}function c(n,t,e,r,i,o,a,l){var c=.5*(i+a),f=.5*(o+l),s=e>=c,h=r>=f,p=h<<1|s;n.leaf=!1,n=n.nodes[p]||(n.nodes[p]=hr()),s?i=c:a=c,h?o=f:l=f,u(n,t,e,r,i,o,a,l)}var f,s,h,p,g,v,d,y,m,M=En(a),x=En(l);if(null!=t)v=t,d=e,y=r,m=i;else if(y=m=-(v=d=1/0),s=[],h=[],g=n.length,o)for(p=0;g>p;++p)f=n[p],f.x<v&&(v=f.x),f.y<d&&(d=f.y),f.x>y&&(y=f.x),f.y>m&&(m=f.y),s.push(f.x),h.push(f.y);else for(p=0;g>p;++p){var b=+M(f=n[p],p),_=+x(f,p);v>b&&(v=b),d>_&&(d=_),b>y&&(y=b),_>m&&(m=_),s.push(b),h.push(_)}var w=y-v,S=m-d;w>S?m=d+w:y=v+S;var k=hr();if(k.add=function(n){u(k,n,+M(n,++p),+x(n,p),v,d,y,m)},k.visit=function(n){pr(n,k,v,d,y,m)},k.find=function(n){return gr(k,n[0],n[1],v,d,y,m)},p=-1,null==t){for(;++p<g;)u(k,n[p],s[p],h[p],v,d,y,m);--p}else n.forEach(k.add);return s=h=n=f=null,k}var o,a=Ce,l=ze;return(o=arguments.length)?(a=fr,l=sr,3===o&&(i=e,r=t,e=t=0),u(n)):(u.x=function(n){return arguments.length?(a=n,u):a},u.y=function(n){return arguments.length?(l=n,u):l},u.extent=function(n){return arguments.length?(null==n?t=e=r=i=null:(t=+n[0][0],e=+n[0][1],r=+n[1][0],i=+n[1][1]),u):null==t?null:[[t,e],[r,i]]},u.size=function(n){return arguments.length?(null==n?t=e=r=i=null:(t=e=0,r=+n[0],i=+n[1]),u):null==t?null:[r-t,i-e]},u)},ao.interpolateRgb=vr,ao.interpolateObject=dr,ao.interpolateNumber=yr,ao.interpolateString=mr;var hl=/[-+]?(?:\d+\.?\d*|\.?\d+)(?:[eE][-+]?\d+)?/g,pl=new RegExp(hl.source,"g");ao.interpolate=Mr,ao.interpolators=[function(n,t){var e=typeof t;return("string"===e?ua.has(t.toLowerCase())||/^(#|rgb\(|hsl\()/i.test(t)?vr:mr:t instanceof an?vr:Array.isArray(t)?xr:"object"===e&&isNaN(t)?dr:yr)(n,t)}],ao.interpolateArray=xr;var gl=function(){return m},vl=ao.map({linear:gl,poly:Er,quad:function(){return Sr},cubic:function(){return kr},sin:function(){return Ar},exp:function(){return Cr},circle:function(){return zr},elastic:Lr,back:qr,bounce:function(){return Tr}}),dl=ao.map({"in":m,out:_r,"in-out":wr,"out-in":function(n){return wr(_r(n))}});ao.ease=function(n){var t=n.indexOf("-"),e=t>=0?n.slice(0,t):n,r=t>=0?n.slice(t+1):"in";return e=vl.get(e)||gl,r=dl.get(r)||m,br(r(e.apply(null,lo.call(arguments,1))))},ao.interpolateHcl=Rr,ao.interpolateHsl=Dr,ao.interpolateLab=Pr,ao.interpolateRound=Ur,ao.transform=function(n){var t=fo.createElementNS(ao.ns.prefix.svg,"g");return(ao.transform=function(n){if(null!=n){t.setAttribute("transform",n);var e=t.transform.baseVal.consolidate()}return new jr(e?e.matrix:yl)})(n)},jr.prototype.toString=function(){return"translate("+this.translate+")rotate("+this.rotate+")skewX("+this.skew+")scale("+this.scale+")"};var yl={a:1,b:0,c:0,d:1,e:0,f:0};ao.interpolateTransform=$r,ao.layout={},ao.layout.bundle=function(){return function(n){for(var t=[],e=-1,r=n.length;++e<r;)t.push(Jr(n[e]));return t}},ao.layout.chord=function(){function n(){var n,c,s,h,p,g={},v=[],d=ao.range(u),y=[];for(e=[],r=[],n=0,h=-1;++h<u;){for(c=0,p=-1;++p<u;)c+=i[h][p];v.push(c),y.push(ao.range(u)),n+=c}for(o&&d.sort(function(n,t){return o(v[n],v[t])}),a&&y.forEach(function(n,t){n.sort(function(n,e){return a(i[t][n],i[t][e])})}),n=(Ho-f*u)/n,c=0,h=-1;++h<u;){for(s=c,p=-1;++p<u;){var m=d[h],M=y[m][p],x=i[m][M],b=c,_=c+=x*n;g[m+"-"+M]={index:m,subindex:M,startAngle:b,endAngle:_,value:x}}r[m]={index:m,startAngle:s,endAngle:c,value:v[m]},c+=f}for(h=-1;++h<u;)for(p=h-1;++p<u;){var w=g[h+"-"+p],S=g[p+"-"+h];(w.value||S.value)&&e.push(w.value<S.value?{source:S,target:w}:{source:w,target:S})}l&&t()}function t(){e.sort(function(n,t){return l((n.source.value+n.target.value)/2,(t.source.value+t.target.value)/2)})}var e,r,i,u,o,a,l,c={},f=0;return c.matrix=function(n){return arguments.length?(u=(i=n)&&i.length,e=r=null,c):i},c.padding=function(n){return arguments.length?(f=n,e=r=null,c):f},c.sortGroups=function(n){return arguments.length?(o=n,e=r=null,c):o},c.sortSubgroups=function(n){return arguments.length?(a=n,e=null,c):a},c.sortChords=function(n){return arguments.length?(l=n,e&&t(),c):l},c.chords=function(){return e||n(),e},c.groups=function(){return r||n(),r},c},ao.layout.force=function(){function n(n){return function(t,e,r,i){if(t.point!==n){var u=t.cx-n.x,o=t.cy-n.y,a=i-e,l=u*u+o*o;if(l>a*a/y){if(v>l){var c=t.charge/l;n.px-=u*c,n.py-=o*c}return!0}if(t.point&&l&&v>l){var c=t.pointCharge/l;n.px-=u*c,n.py-=o*c}}return!t.charge}}function t(n){n.px=ao.event.x,n.py=ao.event.y,l.resume()}var e,r,i,u,o,a,l={},c=ao.dispatch("start","tick","end"),f=[1,1],s=.9,h=ml,p=Ml,g=-30,v=xl,d=.1,y=.64,M=[],x=[];return l.tick=function(){if((i*=.99)<.005)return e=null,c.end({type:"end",alpha:i=0}),!0;var t,r,l,h,p,v,y,m,b,_=M.length,w=x.length;for(r=0;w>r;++r)l=x[r],h=l.source,p=l.target,m=p.x-h.x,b=p.y-h.y,(v=m*m+b*b)&&(v=i*o[r]*((v=Math.sqrt(v))-u[r])/v,m*=v,b*=v,p.x-=m*(y=h.weight+p.weight?h.weight/(h.weight+p.weight):.5),p.y-=b*y,h.x+=m*(y=1-y),h.y+=b*y);if((y=i*d)&&(m=f[0]/2,b=f[1]/2,r=-1,y))for(;++r<_;)l=M[r],l.x+=(m-l.x)*y,l.y+=(b-l.y)*y;if(g)for(ri(t=ao.geom.quadtree(M),i,a),r=-1;++r<_;)(l=M[r]).fixed||t.visit(n(l));for(r=-1;++r<_;)l=M[r],l.fixed?(l.x=l.px,l.y=l.py):(l.x-=(l.px-(l.px=l.x))*s,l.y-=(l.py-(l.py=l.y))*s);c.tick({type:"tick",alpha:i})},l.nodes=function(n){return arguments.length?(M=n,l):M},l.links=function(n){return arguments.length?(x=n,l):x},l.size=function(n){return arguments.length?(f=n,l):f},l.linkDistance=function(n){return arguments.length?(h="function"==typeof n?n:+n,l):h},l.distance=l.linkDistance,l.linkStrength=function(n){return arguments.length?(p="function"==typeof n?n:+n,l):p},l.friction=function(n){return arguments.length?(s=+n,l):s},l.charge=function(n){return arguments.length?(g="function"==typeof n?n:+n,l):g},l.chargeDistance=function(n){return arguments.length?(v=n*n,l):Math.sqrt(v)},l.gravity=function(n){return arguments.length?(d=+n,l):d},l.theta=function(n){return arguments.length?(y=n*n,l):Math.sqrt(y)},l.alpha=function(n){return arguments.length?(n=+n,i?n>0?i=n:(e.c=null,e.t=NaN,e=null,c.end({type:"end",alpha:i=0})):n>0&&(c.start({type:"start",alpha:i=n}),e=qn(l.tick)),l):i},l.start=function(){function n(n,r){if(!e){for(e=new Array(i),l=0;i>l;++l)e[l]=[];for(l=0;c>l;++l){var u=x[l];e[u.source.index].push(u.target),e[u.target.index].push(u.source)}}for(var o,a=e[t],l=-1,f=a.length;++l<f;)if(!isNaN(o=a[l][n]))return o;return Math.random()*r}var t,e,r,i=M.length,c=x.length,s=f[0],v=f[1];for(t=0;i>t;++t)(r=M[t]).index=t,r.weight=0;for(t=0;c>t;++t)r=x[t],"number"==typeof r.source&&(r.source=M[r.source]),"number"==typeof r.target&&(r.target=M[r.target]),++r.source.weight,++r.target.weight;for(t=0;i>t;++t)r=M[t],isNaN(r.x)&&(r.x=n("x",s)),isNaN(r.y)&&(r.y=n("y",v)),isNaN(r.px)&&(r.px=r.x),isNaN(r.py)&&(r.py=r.y);if(u=[],"function"==typeof h)for(t=0;c>t;++t)u[t]=+h.call(this,x[t],t);else for(t=0;c>t;++t)u[t]=h;if(o=[],"function"==typeof p)for(t=0;c>t;++t)o[t]=+p.call(this,x[t],t);else for(t=0;c>t;++t)o[t]=p;if(a=[],"function"==typeof g)for(t=0;i>t;++t)a[t]=+g.call(this,M[t],t);else for(t=0;i>t;++t)a[t]=g;return l.resume()},l.resume=function(){return l.alpha(.1)},l.stop=function(){return l.alpha(0)},l.drag=function(){return r||(r=ao.behavior.drag().origin(m).on("dragstart.force",Qr).on("drag.force",t).on("dragend.force",ni)),arguments.length?void this.on("mouseover.force",ti).on("mouseout.force",ei).call(r):r},ao.rebind(l,c,"on")};var ml=20,Ml=1,xl=1/0;ao.layout.hierarchy=function(){function n(i){var u,o=[i],a=[];for(i.depth=0;null!=(u=o.pop());)if(a.push(u),(c=e.call(n,u,u.depth))&&(l=c.length)){for(var l,c,f;--l>=0;)o.push(f=c[l]),f.parent=u,f.depth=u.depth+1;r&&(u.value=0),u.children=c}else r&&(u.value=+r.call(n,u,u.depth)||0),delete u.children;return oi(i,function(n){var e,i;t&&(e=n.children)&&e.sort(t),r&&(i=n.parent)&&(i.value+=n.value)}),a}var t=ci,e=ai,r=li;return n.sort=function(e){return arguments.length?(t=e,n):t},n.children=function(t){return arguments.length?(e=t,n):e},n.value=function(t){return arguments.length?(r=t,n):r},n.revalue=function(t){return r&&(ui(t,function(n){n.children&&(n.value=0)}),oi(t,function(t){var e;t.children||(t.value=+r.call(n,t,t.depth)||0),(e=t.parent)&&(e.value+=t.value)})),t},n},ao.layout.partition=function(){function n(t,e,r,i){var u=t.children;if(t.x=e,t.y=t.depth*i,t.dx=r,t.dy=i,u&&(o=u.length)){var o,a,l,c=-1;for(r=t.value?r/t.value:0;++c<o;)n(a=u[c],e,l=a.value*r,i),e+=l}}function t(n){var e=n.children,r=0;if(e&&(i=e.length))for(var i,u=-1;++u<i;)r=Math.max(r,t(e[u]));return 1+r}function e(e,u){var o=r.call(this,e,u);return n(o[0],0,i[0],i[1]/t(o[0])),o}var r=ao.layout.hierarchy(),i=[1,1];return e.size=function(n){return arguments.length?(i=n,e):i},ii(e,r)},ao.layout.pie=function(){function n(o){var a,l=o.length,c=o.map(function(e,r){return+t.call(n,e,r)}),f=+("function"==typeof r?r.apply(this,arguments):r),s=("function"==typeof i?i.apply(this,arguments):i)-f,h=Math.min(Math.abs(s)/l,+("function"==typeof u?u.apply(this,arguments):u)),p=h*(0>s?-1:1),g=ao.sum(c),v=g?(s-l*p)/g:0,d=ao.range(l),y=[];return null!=e&&d.sort(e===bl?function(n,t){return c[t]-c[n]}:function(n,t){return e(o[n],o[t])}),d.forEach(function(n){y[n]={data:o[n],value:a=c[n],startAngle:f,endAngle:f+=a*v+p,padAngle:h}}),y}var t=Number,e=bl,r=0,i=Ho,u=0;return n.value=function(e){return arguments.length?(t=e,n):t},n.sort=function(t){return arguments.length?(e=t,n):e},n.startAngle=function(t){return arguments.length?(r=t,n):r},n.endAngle=function(t){return arguments.length?(i=t,n):i},n.padAngle=function(t){return arguments.length?(u=t,n):u},n};var bl={};ao.layout.stack=function(){function n(a,l){if(!(h=a.length))return a;var c=a.map(function(e,r){return t.call(n,e,r)}),f=c.map(function(t){return t.map(function(t,e){return[u.call(n,t,e),o.call(n,t,e)]})}),s=e.call(n,f,l);c=ao.permute(c,s),f=ao.permute(f,s);var h,p,g,v,d=r.call(n,f,l),y=c[0].length;for(g=0;y>g;++g)for(i.call(n,c[0][g],v=d[g],f[0][g][1]),p=1;h>p;++p)i.call(n,c[p][g],v+=f[p-1][g][1],f[p][g][1]);return a}var t=m,e=gi,r=vi,i=pi,u=si,o=hi;return n.values=function(e){return arguments.length?(t=e,n):t},n.order=function(t){return arguments.length?(e="function"==typeof t?t:_l.get(t)||gi,n):e},n.offset=function(t){return arguments.length?(r="function"==typeof t?t:wl.get(t)||vi,n):r},n.x=function(t){return arguments.length?(u=t,n):u},n.y=function(t){return arguments.length?(o=t,n):o},n.out=function(t){return arguments.length?(i=t,n):i},n};var _l=ao.map({"inside-out":function(n){var t,e,r=n.length,i=n.map(di),u=n.map(yi),o=ao.range(r).sort(function(n,t){return i[n]-i[t]}),a=0,l=0,c=[],f=[];for(t=0;r>t;++t)e=o[t],l>a?(a+=u[e],c.push(e)):(l+=u[e],f.push(e));return f.reverse().concat(c)},reverse:function(n){return ao.range(n.length).reverse()},"default":gi}),wl=ao.map({silhouette:function(n){var t,e,r,i=n.length,u=n[0].length,o=[],a=0,l=[];for(e=0;u>e;++e){for(t=0,r=0;i>t;t++)r+=n[t][e][1];r>a&&(a=r),o.push(r)}for(e=0;u>e;++e)l[e]=(a-o[e])/2;return l},wiggle:function(n){var t,e,r,i,u,o,a,l,c,f=n.length,s=n[0],h=s.length,p=[];for(p[0]=l=c=0,e=1;h>e;++e){for(t=0,i=0;f>t;++t)i+=n[t][e][1];for(t=0,u=0,a=s[e][0]-s[e-1][0];f>t;++t){for(r=0,o=(n[t][e][1]-n[t][e-1][1])/(2*a);t>r;++r)o+=(n[r][e][1]-n[r][e-1][1])/a;u+=o*n[t][e][1]}p[e]=l-=i?u/i*a:0,c>l&&(c=l)}for(e=0;h>e;++e)p[e]-=c;return p},expand:function(n){var t,e,r,i=n.length,u=n[0].length,o=1/i,a=[];for(e=0;u>e;++e){for(t=0,r=0;i>t;t++)r+=n[t][e][1];if(r)for(t=0;i>t;t++)n[t][e][1]/=r;else for(t=0;i>t;t++)n[t][e][1]=o}for(e=0;u>e;++e)a[e]=0;return a},zero:vi});ao.layout.histogram=function(){function n(n,u){for(var o,a,l=[],c=n.map(e,this),f=r.call(this,c,u),s=i.call(this,f,c,u),u=-1,h=c.length,p=s.length-1,g=t?1:1/h;++u<p;)o=l[u]=[],o.dx=s[u+1]-(o.x=s[u]),o.y=0;if(p>0)for(u=-1;++u<h;)a=c[u],a>=f[0]&&a<=f[1]&&(o=l[ao.bisect(s,a,1,p)-1],o.y+=g,o.push(n[u]));return l}var t=!0,e=Number,r=bi,i=Mi;return n.value=function(t){return arguments.length?(e=t,n):e},n.range=function(t){return arguments.length?(r=En(t),n):r},n.bins=function(t){return arguments.length?(i="number"==typeof t?function(n){return xi(n,t)}:En(t),n):i},n.frequency=function(e){return arguments.length?(t=!!e,n):t},n},ao.layout.pack=function(){function n(n,u){var o=e.call(this,n,u),a=o[0],l=i[0],c=i[1],f=null==t?Math.sqrt:"function"==typeof t?t:function(){return t};if(a.x=a.y=0,oi(a,function(n){n.r=+f(n.value)}),oi(a,Ni),r){var s=r*(t?1:Math.max(2*a.r/l,2*a.r/c))/2;oi(a,function(n){n.r+=s}),oi(a,Ni),oi(a,function(n){n.r-=s})}return Ci(a,l/2,c/2,t?1:1/Math.max(2*a.r/l,2*a.r/c)),o}var t,e=ao.layout.hierarchy().sort(_i),r=0,i=[1,1];return n.size=function(t){return arguments.length?(i=t,n):i},n.radius=function(e){return arguments.length?(t=null==e||"function"==typeof e?e:+e,n):t},n.padding=function(t){return arguments.length?(r=+t,n):r},ii(n,e)},ao.layout.tree=function(){function n(n,i){var f=o.call(this,n,i),s=f[0],h=t(s);if(oi(h,e),h.parent.m=-h.z,ui(h,r),c)ui(s,u);else{var p=s,g=s,v=s;ui(s,function(n){n.x<p.x&&(p=n),n.x>g.x&&(g=n),n.depth>v.depth&&(v=n)});var d=a(p,g)/2-p.x,y=l[0]/(g.x+a(g,p)/2+d),m=l[1]/(v.depth||1);ui(s,function(n){n.x=(n.x+d)*y,n.y=n.depth*m})}return f}function t(n){for(var t,e={A:null,children:[n]},r=[e];null!=(t=r.pop());)for(var i,u=t.children,o=0,a=u.length;a>o;++o)r.push((u[o]=i={_:u[o],parent:t,children:(i=u[o].children)&&i.slice()||[],A:null,a:null,z:0,m:0,c:0,s:0,t:null,i:o}).a=i);return e.children[0]}function e(n){var t=n.children,e=n.parent.children,r=n.i?e[n.i-1]:null;if(t.length){Di(n);var u=(t[0].z+t[t.length-1].z)/2;r?(n.z=r.z+a(n._,r._),n.m=n.z-u):n.z=u}else r&&(n.z=r.z+a(n._,r._));n.parent.A=i(n,r,n.parent.A||e[0])}function r(n){n._.x=n.z+n.parent.m,n.m+=n.parent.m}function i(n,t,e){if(t){for(var r,i=n,u=n,o=t,l=i.parent.children[0],c=i.m,f=u.m,s=o.m,h=l.m;o=Ti(o),i=qi(i),o&&i;)l=qi(l),u=Ti(u),u.a=n,r=o.z+s-i.z-c+a(o._,i._),r>0&&(Ri(Pi(o,n,e),n,r),c+=r,f+=r),s+=o.m,c+=i.m,h+=l.m,f+=u.m;o&&!Ti(u)&&(u.t=o,u.m+=s-f),i&&!qi(l)&&(l.t=i,l.m+=c-h,e=n)}return e}function u(n){n.x*=l[0],n.y=n.depth*l[1]}var o=ao.layout.hierarchy().sort(null).value(null),a=Li,l=[1,1],c=null;return n.separation=function(t){return arguments.length?(a=t,n):a},n.size=function(t){return arguments.length?(c=null==(l=t)?u:null,n):c?null:l},n.nodeSize=function(t){return arguments.length?(c=null==(l=t)?null:u,n):c?l:null},ii(n,o)},ao.layout.cluster=function(){function n(n,u){var o,a=t.call(this,n,u),l=a[0],c=0;oi(l,function(n){var t=n.children;t&&t.length?(n.x=ji(t),n.y=Ui(t)):(n.x=o?c+=e(n,o):0,n.y=0,o=n)});var f=Fi(l),s=Hi(l),h=f.x-e(f,s)/2,p=s.x+e(s,f)/2;return oi(l,i?function(n){n.x=(n.x-l.x)*r[0],n.y=(l.y-n.y)*r[1]}:function(n){n.x=(n.x-h)/(p-h)*r[0],n.y=(1-(l.y?n.y/l.y:1))*r[1]}),a}var t=ao.layout.hierarchy().sort(null).value(null),e=Li,r=[1,1],i=!1;return n.separation=function(t){return arguments.length?(e=t,n):e},n.size=function(t){return arguments.length?(i=null==(r=t),n):i?null:r},n.nodeSize=function(t){return arguments.length?(i=null!=(r=t),n):i?r:null},ii(n,t)},ao.layout.treemap=function(){function n(n,t){for(var e,r,i=-1,u=n.length;++i<u;)r=(e=n[i]).value*(0>t?0:t),e.area=isNaN(r)||0>=r?0:r}function t(e){var u=e.children;if(u&&u.length){var o,a,l,c=s(e),f=[],h=u.slice(),g=1/0,v="slice"===p?c.dx:"dice"===p?c.dy:"slice-dice"===p?1&e.depth?c.dy:c.dx:Math.min(c.dx,c.dy);for(n(h,c.dx*c.dy/e.value),f.area=0;(l=h.length)>0;)f.push(o=h[l-1]),f.area+=o.area,"squarify"!==p||(a=r(f,v))<=g?(h.pop(),g=a):(f.area-=f.pop().area,i(f,v,c,!1),v=Math.min(c.dx,c.dy),f.length=f.area=0,g=1/0);f.length&&(i(f,v,c,!0),f.length=f.area=0),u.forEach(t)}}function e(t){var r=t.children;if(r&&r.length){var u,o=s(t),a=r.slice(),l=[];for(n(a,o.dx*o.dy/t.value),l.area=0;u=a.pop();)l.push(u),l.area+=u.area,null!=u.z&&(i(l,u.z?o.dx:o.dy,o,!a.length),l.length=l.area=0);r.forEach(e)}}function r(n,t){for(var e,r=n.area,i=0,u=1/0,o=-1,a=n.length;++o<a;)(e=n[o].area)&&(u>e&&(u=e),e>i&&(i=e));return r*=r,t*=t,r?Math.max(t*i*g/r,r/(t*u*g)):1/0}function i(n,t,e,r){var i,u=-1,o=n.length,a=e.x,c=e.y,f=t?l(n.area/t):0;
if(t==e.dx){for((r||f>e.dy)&&(f=e.dy);++u<o;)i=n[u],i.x=a,i.y=c,i.dy=f,a+=i.dx=Math.min(e.x+e.dx-a,f?l(i.area/f):0);i.z=!0,i.dx+=e.x+e.dx-a,e.y+=f,e.dy-=f}else{for((r||f>e.dx)&&(f=e.dx);++u<o;)i=n[u],i.x=a,i.y=c,i.dx=f,c+=i.dy=Math.min(e.y+e.dy-c,f?l(i.area/f):0);i.z=!1,i.dy+=e.y+e.dy-c,e.x+=f,e.dx-=f}}function u(r){var i=o||a(r),u=i[0];return u.x=u.y=0,u.value?(u.dx=c[0],u.dy=c[1]):u.dx=u.dy=0,o&&a.revalue(u),n([u],u.dx*u.dy/u.value),(o?e:t)(u),h&&(o=i),i}var o,a=ao.layout.hierarchy(),l=Math.round,c=[1,1],f=null,s=Oi,h=!1,p="squarify",g=.5*(1+Math.sqrt(5));return u.size=function(n){return arguments.length?(c=n,u):c},u.padding=function(n){function t(t){var e=n.call(u,t,t.depth);return null==e?Oi(t):Ii(t,"number"==typeof e?[e,e,e,e]:e)}function e(t){return Ii(t,n)}if(!arguments.length)return f;var r;return s=null==(f=n)?Oi:"function"==(r=typeof n)?t:"number"===r?(n=[n,n,n,n],e):e,u},u.round=function(n){return arguments.length?(l=n?Math.round:Number,u):l!=Number},u.sticky=function(n){return arguments.length?(h=n,o=null,u):h},u.ratio=function(n){return arguments.length?(g=n,u):g},u.mode=function(n){return arguments.length?(p=n+"",u):p},ii(u,a)},ao.random={normal:function(n,t){var e=arguments.length;return 2>e&&(t=1),1>e&&(n=0),function(){var e,r,i;do e=2*Math.random()-1,r=2*Math.random()-1,i=e*e+r*r;while(!i||i>1);return n+t*e*Math.sqrt(-2*Math.log(i)/i)}},logNormal:function(){var n=ao.random.normal.apply(ao,arguments);return function(){return Math.exp(n())}},bates:function(n){var t=ao.random.irwinHall(n);return function(){return t()/n}},irwinHall:function(n){return function(){for(var t=0,e=0;n>e;e++)t+=Math.random();return t}}},ao.scale={};var Sl={floor:m,ceil:m};ao.scale.linear=function(){return Wi([0,1],[0,1],Mr,!1)};var kl={s:1,g:1,p:1,r:1,e:1};ao.scale.log=function(){return ru(ao.scale.linear().domain([0,1]),10,!0,[1,10])};var Nl=ao.format(".0e"),El={floor:function(n){return-Math.ceil(-n)},ceil:function(n){return-Math.floor(-n)}};ao.scale.pow=function(){return iu(ao.scale.linear(),1,[0,1])},ao.scale.sqrt=function(){return ao.scale.pow().exponent(.5)},ao.scale.ordinal=function(){return ou([],{t:"range",a:[[]]})},ao.scale.category10=function(){return ao.scale.ordinal().range(Al)},ao.scale.category20=function(){return ao.scale.ordinal().range(Cl)},ao.scale.category20b=function(){return ao.scale.ordinal().range(zl)},ao.scale.category20c=function(){return ao.scale.ordinal().range(Ll)};var Al=[2062260,16744206,2924588,14034728,9725885,9197131,14907330,8355711,12369186,1556175].map(xn),Cl=[2062260,11454440,16744206,16759672,2924588,10018698,14034728,16750742,9725885,12955861,9197131,12885140,14907330,16234194,8355711,13092807,12369186,14408589,1556175,10410725].map(xn),zl=[3750777,5395619,7040719,10264286,6519097,9216594,11915115,13556636,9202993,12426809,15186514,15190932,8666169,11356490,14049643,15177372,8077683,10834324,13528509,14589654].map(xn),Ll=[3244733,7057110,10406625,13032431,15095053,16616764,16625259,16634018,3253076,7652470,10607003,13101504,7695281,10394312,12369372,14342891,6513507,9868950,12434877,14277081].map(xn);ao.scale.quantile=function(){return au([],[])},ao.scale.quantize=function(){return lu(0,1,[0,1])},ao.scale.threshold=function(){return cu([.5],[0,1])},ao.scale.identity=function(){return fu([0,1])},ao.svg={},ao.svg.arc=function(){function n(){var n=Math.max(0,+e.apply(this,arguments)),c=Math.max(0,+r.apply(this,arguments)),f=o.apply(this,arguments)-Io,s=a.apply(this,arguments)-Io,h=Math.abs(s-f),p=f>s?0:1;if(n>c&&(g=c,c=n,n=g),h>=Oo)return t(c,p)+(n?t(n,1-p):"")+"Z";var g,v,d,y,m,M,x,b,_,w,S,k,N=0,E=0,A=[];if((y=(+l.apply(this,arguments)||0)/2)&&(d=u===ql?Math.sqrt(n*n+c*c):+u.apply(this,arguments),p||(E*=-1),c&&(E=tn(d/c*Math.sin(y))),n&&(N=tn(d/n*Math.sin(y)))),c){m=c*Math.cos(f+E),M=c*Math.sin(f+E),x=c*Math.cos(s-E),b=c*Math.sin(s-E);var C=Math.abs(s-f-2*E)<=Fo?0:1;if(E&&yu(m,M,x,b)===p^C){var z=(f+s)/2;m=c*Math.cos(z),M=c*Math.sin(z),x=b=null}}else m=M=0;if(n){_=n*Math.cos(s-N),w=n*Math.sin(s-N),S=n*Math.cos(f+N),k=n*Math.sin(f+N);var L=Math.abs(f-s+2*N)<=Fo?0:1;if(N&&yu(_,w,S,k)===1-p^L){var q=(f+s)/2;_=n*Math.cos(q),w=n*Math.sin(q),S=k=null}}else _=w=0;if(h>Uo&&(g=Math.min(Math.abs(c-n)/2,+i.apply(this,arguments)))>.001){v=c>n^p?0:1;var T=g,R=g;if(Fo>h){var D=null==S?[_,w]:null==x?[m,M]:Re([m,M],[S,k],[x,b],[_,w]),P=m-D[0],U=M-D[1],j=x-D[0],F=b-D[1],H=1/Math.sin(Math.acos((P*j+U*F)/(Math.sqrt(P*P+U*U)*Math.sqrt(j*j+F*F)))/2),O=Math.sqrt(D[0]*D[0]+D[1]*D[1]);R=Math.min(g,(n-O)/(H-1)),T=Math.min(g,(c-O)/(H+1))}if(null!=x){var I=mu(null==S?[_,w]:[S,k],[m,M],c,T,p),Y=mu([x,b],[_,w],c,T,p);g===T?A.push("M",I[0],"A",T,",",T," 0 0,",v," ",I[1],"A",c,",",c," 0 ",1-p^yu(I[1][0],I[1][1],Y[1][0],Y[1][1]),",",p," ",Y[1],"A",T,",",T," 0 0,",v," ",Y[0]):A.push("M",I[0],"A",T,",",T," 0 1,",v," ",Y[0])}else A.push("M",m,",",M);if(null!=S){var Z=mu([m,M],[S,k],n,-R,p),V=mu([_,w],null==x?[m,M]:[x,b],n,-R,p);g===R?A.push("L",V[0],"A",R,",",R," 0 0,",v," ",V[1],"A",n,",",n," 0 ",p^yu(V[1][0],V[1][1],Z[1][0],Z[1][1]),",",1-p," ",Z[1],"A",R,",",R," 0 0,",v," ",Z[0]):A.push("L",V[0],"A",R,",",R," 0 0,",v," ",Z[0])}else A.push("L",_,",",w)}else A.push("M",m,",",M),null!=x&&A.push("A",c,",",c," 0 ",C,",",p," ",x,",",b),A.push("L",_,",",w),null!=S&&A.push("A",n,",",n," 0 ",L,",",1-p," ",S,",",k);return A.push("Z"),A.join("")}function t(n,t){return"M0,"+n+"A"+n+","+n+" 0 1,"+t+" 0,"+-n+"A"+n+","+n+" 0 1,"+t+" 0,"+n}var e=hu,r=pu,i=su,u=ql,o=gu,a=vu,l=du;return n.innerRadius=function(t){return arguments.length?(e=En(t),n):e},n.outerRadius=function(t){return arguments.length?(r=En(t),n):r},n.cornerRadius=function(t){return arguments.length?(i=En(t),n):i},n.padRadius=function(t){return arguments.length?(u=t==ql?ql:En(t),n):u},n.startAngle=function(t){return arguments.length?(o=En(t),n):o},n.endAngle=function(t){return arguments.length?(a=En(t),n):a},n.padAngle=function(t){return arguments.length?(l=En(t),n):l},n.centroid=function(){var n=(+e.apply(this,arguments)+ +r.apply(this,arguments))/2,t=(+o.apply(this,arguments)+ +a.apply(this,arguments))/2-Io;return[Math.cos(t)*n,Math.sin(t)*n]},n};var ql="auto";ao.svg.line=function(){return Mu(m)};var Tl=ao.map({linear:xu,"linear-closed":bu,step:_u,"step-before":wu,"step-after":Su,basis:zu,"basis-open":Lu,"basis-closed":qu,bundle:Tu,cardinal:Eu,"cardinal-open":ku,"cardinal-closed":Nu,monotone:Fu});Tl.forEach(function(n,t){t.key=n,t.closed=/-closed$/.test(n)});var Rl=[0,2/3,1/3,0],Dl=[0,1/3,2/3,0],Pl=[0,1/6,2/3,1/6];ao.svg.line.radial=function(){var n=Mu(Hu);return n.radius=n.x,delete n.x,n.angle=n.y,delete n.y,n},wu.reverse=Su,Su.reverse=wu,ao.svg.area=function(){return Ou(m)},ao.svg.area.radial=function(){var n=Ou(Hu);return n.radius=n.x,delete n.x,n.innerRadius=n.x0,delete n.x0,n.outerRadius=n.x1,delete n.x1,n.angle=n.y,delete n.y,n.startAngle=n.y0,delete n.y0,n.endAngle=n.y1,delete n.y1,n},ao.svg.chord=function(){function n(n,a){var l=t(this,u,n,a),c=t(this,o,n,a);return"M"+l.p0+r(l.r,l.p1,l.a1-l.a0)+(e(l,c)?i(l.r,l.p1,l.r,l.p0):i(l.r,l.p1,c.r,c.p0)+r(c.r,c.p1,c.a1-c.a0)+i(c.r,c.p1,l.r,l.p0))+"Z"}function t(n,t,e,r){var i=t.call(n,e,r),u=a.call(n,i,r),o=l.call(n,i,r)-Io,f=c.call(n,i,r)-Io;return{r:u,a0:o,a1:f,p0:[u*Math.cos(o),u*Math.sin(o)],p1:[u*Math.cos(f),u*Math.sin(f)]}}function e(n,t){return n.a0==t.a0&&n.a1==t.a1}function r(n,t,e){return"A"+n+","+n+" 0 "+ +(e>Fo)+",1 "+t}function i(n,t,e,r){return"Q 0,0 "+r}var u=Me,o=xe,a=Iu,l=gu,c=vu;return n.radius=function(t){return arguments.length?(a=En(t),n):a},n.source=function(t){return arguments.length?(u=En(t),n):u},n.target=function(t){return arguments.length?(o=En(t),n):o},n.startAngle=function(t){return arguments.length?(l=En(t),n):l},n.endAngle=function(t){return arguments.length?(c=En(t),n):c},n},ao.svg.diagonal=function(){function n(n,i){var u=t.call(this,n,i),o=e.call(this,n,i),a=(u.y+o.y)/2,l=[u,{x:u.x,y:a},{x:o.x,y:a},o];return l=l.map(r),"M"+l[0]+"C"+l[1]+" "+l[2]+" "+l[3]}var t=Me,e=xe,r=Yu;return n.source=function(e){return arguments.length?(t=En(e),n):t},n.target=function(t){return arguments.length?(e=En(t),n):e},n.projection=function(t){return arguments.length?(r=t,n):r},n},ao.svg.diagonal.radial=function(){var n=ao.svg.diagonal(),t=Yu,e=n.projection;return n.projection=function(n){return arguments.length?e(Zu(t=n)):t},n},ao.svg.symbol=function(){function n(n,r){return(Ul.get(t.call(this,n,r))||$u)(e.call(this,n,r))}var t=Xu,e=Vu;return n.type=function(e){return arguments.length?(t=En(e),n):t},n.size=function(t){return arguments.length?(e=En(t),n):e},n};var Ul=ao.map({circle:$u,cross:function(n){var t=Math.sqrt(n/5)/2;return"M"+-3*t+","+-t+"H"+-t+"V"+-3*t+"H"+t+"V"+-t+"H"+3*t+"V"+t+"H"+t+"V"+3*t+"H"+-t+"V"+t+"H"+-3*t+"Z"},diamond:function(n){var t=Math.sqrt(n/(2*Fl)),e=t*Fl;return"M0,"+-t+"L"+e+",0 0,"+t+" "+-e+",0Z"},square:function(n){var t=Math.sqrt(n)/2;return"M"+-t+","+-t+"L"+t+","+-t+" "+t+","+t+" "+-t+","+t+"Z"},"triangle-down":function(n){var t=Math.sqrt(n/jl),e=t*jl/2;return"M0,"+e+"L"+t+","+-e+" "+-t+","+-e+"Z"},"triangle-up":function(n){var t=Math.sqrt(n/jl),e=t*jl/2;return"M0,"+-e+"L"+t+","+e+" "+-t+","+e+"Z"}});ao.svg.symbolTypes=Ul.keys();var jl=Math.sqrt(3),Fl=Math.tan(30*Yo);Co.transition=function(n){for(var t,e,r=Hl||++Zl,i=Ku(n),u=[],o=Ol||{time:Date.now(),ease:Nr,delay:0,duration:250},a=-1,l=this.length;++a<l;){u.push(t=[]);for(var c=this[a],f=-1,s=c.length;++f<s;)(e=c[f])&&Qu(e,f,i,r,o),t.push(e)}return Wu(u,i,r)},Co.interrupt=function(n){return this.each(null==n?Il:Bu(Ku(n)))};var Hl,Ol,Il=Bu(Ku()),Yl=[],Zl=0;Yl.call=Co.call,Yl.empty=Co.empty,Yl.node=Co.node,Yl.size=Co.size,ao.transition=function(n,t){return n&&n.transition?Hl?n.transition(t):n:ao.selection().transition(n)},ao.transition.prototype=Yl,Yl.select=function(n){var t,e,r,i=this.id,u=this.namespace,o=[];n=A(n);for(var a=-1,l=this.length;++a<l;){o.push(t=[]);for(var c=this[a],f=-1,s=c.length;++f<s;)(r=c[f])&&(e=n.call(r,r.__data__,f,a))?("__data__"in r&&(e.__data__=r.__data__),Qu(e,f,u,i,r[u][i]),t.push(e)):t.push(null)}return Wu(o,u,i)},Yl.selectAll=function(n){var t,e,r,i,u,o=this.id,a=this.namespace,l=[];n=C(n);for(var c=-1,f=this.length;++c<f;)for(var s=this[c],h=-1,p=s.length;++h<p;)if(r=s[h]){u=r[a][o],e=n.call(r,r.__data__,h,c),l.push(t=[]);for(var g=-1,v=e.length;++g<v;)(i=e[g])&&Qu(i,g,a,o,u),t.push(i)}return Wu(l,a,o)},Yl.filter=function(n){var t,e,r,i=[];"function"!=typeof n&&(n=O(n));for(var u=0,o=this.length;o>u;u++){i.push(t=[]);for(var e=this[u],a=0,l=e.length;l>a;a++)(r=e[a])&&n.call(r,r.__data__,a,u)&&t.push(r)}return Wu(i,this.namespace,this.id)},Yl.tween=function(n,t){var e=this.id,r=this.namespace;return arguments.length<2?this.node()[r][e].tween.get(n):Y(this,null==t?function(t){t[r][e].tween.remove(n)}:function(i){i[r][e].tween.set(n,t)})},Yl.attr=function(n,t){function e(){this.removeAttribute(a)}function r(){this.removeAttributeNS(a.space,a.local)}function i(n){return null==n?e:(n+="",function(){var t,e=this.getAttribute(a);return e!==n&&(t=o(e,n),function(n){this.setAttribute(a,t(n))})})}function u(n){return null==n?r:(n+="",function(){var t,e=this.getAttributeNS(a.space,a.local);return e!==n&&(t=o(e,n),function(n){this.setAttributeNS(a.space,a.local,t(n))})})}if(arguments.length<2){for(t in n)this.attr(t,n[t]);return this}var o="transform"==n?$r:Mr,a=ao.ns.qualify(n);return Ju(this,"attr."+n,t,a.local?u:i)},Yl.attrTween=function(n,t){function e(n,e){var r=t.call(this,n,e,this.getAttribute(i));return r&&function(n){this.setAttribute(i,r(n))}}function r(n,e){var r=t.call(this,n,e,this.getAttributeNS(i.space,i.local));return r&&function(n){this.setAttributeNS(i.space,i.local,r(n))}}var i=ao.ns.qualify(n);return this.tween("attr."+n,i.local?r:e)},Yl.style=function(n,e,r){function i(){this.style.removeProperty(n)}function u(e){return null==e?i:(e+="",function(){var i,u=t(this).getComputedStyle(this,null).getPropertyValue(n);return u!==e&&(i=Mr(u,e),function(t){this.style.setProperty(n,i(t),r)})})}var o=arguments.length;if(3>o){if("string"!=typeof n){2>o&&(e="");for(r in n)this.style(r,n[r],e);return this}r=""}return Ju(this,"style."+n,e,u)},Yl.styleTween=function(n,e,r){function i(i,u){var o=e.call(this,i,u,t(this).getComputedStyle(this,null).getPropertyValue(n));return o&&function(t){this.style.setProperty(n,o(t),r)}}return arguments.length<3&&(r=""),this.tween("style."+n,i)},Yl.text=function(n){return Ju(this,"text",n,Gu)},Yl.remove=function(){var n=this.namespace;return this.each("end.transition",function(){var t;this[n].count<2&&(t=this.parentNode)&&t.removeChild(this)})},Yl.ease=function(n){var t=this.id,e=this.namespace;return arguments.length<1?this.node()[e][t].ease:("function"!=typeof n&&(n=ao.ease.apply(ao,arguments)),Y(this,function(r){r[e][t].ease=n}))},Yl.delay=function(n){var t=this.id,e=this.namespace;return arguments.length<1?this.node()[e][t].delay:Y(this,"function"==typeof n?function(r,i,u){r[e][t].delay=+n.call(r,r.__data__,i,u)}:(n=+n,function(r){r[e][t].delay=n}))},Yl.duration=function(n){var t=this.id,e=this.namespace;return arguments.length<1?this.node()[e][t].duration:Y(this,"function"==typeof n?function(r,i,u){r[e][t].duration=Math.max(1,n.call(r,r.__data__,i,u))}:(n=Math.max(1,n),function(r){r[e][t].duration=n}))},Yl.each=function(n,t){var e=this.id,r=this.namespace;if(arguments.length<2){var i=Ol,u=Hl;try{Hl=e,Y(this,function(t,i,u){Ol=t[r][e],n.call(t,t.__data__,i,u)})}finally{Ol=i,Hl=u}}else Y(this,function(i){var u=i[r][e];(u.event||(u.event=ao.dispatch("start","end","interrupt"))).on(n,t)});return this},Yl.transition=function(){for(var n,t,e,r,i=this.id,u=++Zl,o=this.namespace,a=[],l=0,c=this.length;c>l;l++){a.push(n=[]);for(var t=this[l],f=0,s=t.length;s>f;f++)(e=t[f])&&(r=e[o][i],Qu(e,f,o,u,{time:r.time,ease:r.ease,delay:r.delay+r.duration,duration:r.duration})),n.push(e)}return Wu(a,o,u)},ao.svg.axis=function(){function n(n){n.each(function(){var n,c=ao.select(this),f=this.__chart__||e,s=this.__chart__=e.copy(),h=null==l?s.ticks?s.ticks.apply(s,a):s.domain():l,p=null==t?s.tickFormat?s.tickFormat.apply(s,a):m:t,g=c.selectAll(".tick").data(h,s),v=g.enter().insert("g",".domain").attr("class","tick").style("opacity",Uo),d=ao.transition(g.exit()).style("opacity",Uo).remove(),y=ao.transition(g.order()).style("opacity",1),M=Math.max(i,0)+o,x=Zi(s),b=c.selectAll(".domain").data([0]),_=(b.enter().append("path").attr("class","domain"),ao.transition(b));v.append("line"),v.append("text");var w,S,k,N,E=v.select("line"),A=y.select("line"),C=g.select("text").text(p),z=v.select("text"),L=y.select("text"),q="top"===r||"left"===r?-1:1;if("bottom"===r||"top"===r?(n=no,w="x",k="y",S="x2",N="y2",C.attr("dy",0>q?"0em":".71em").style("text-anchor","middle"),_.attr("d","M"+x[0]+","+q*u+"V0H"+x[1]+"V"+q*u)):(n=to,w="y",k="x",S="y2",N="x2",C.attr("dy",".32em").style("text-anchor",0>q?"end":"start"),_.attr("d","M"+q*u+","+x[0]+"H0V"+x[1]+"H"+q*u)),E.attr(N,q*i),z.attr(k,q*M),A.attr(S,0).attr(N,q*i),L.attr(w,0).attr(k,q*M),s.rangeBand){var T=s,R=T.rangeBand()/2;f=s=function(n){return T(n)+R}}else f.rangeBand?f=s:d.call(n,s,f);v.call(n,f,s),y.call(n,s,s)})}var t,e=ao.scale.linear(),r=Vl,i=6,u=6,o=3,a=[10],l=null;return n.scale=function(t){return arguments.length?(e=t,n):e},n.orient=function(t){return arguments.length?(r=t in Xl?t+"":Vl,n):r},n.ticks=function(){return arguments.length?(a=co(arguments),n):a},n.tickValues=function(t){return arguments.length?(l=t,n):l},n.tickFormat=function(e){return arguments.length?(t=e,n):t},n.tickSize=function(t){var e=arguments.length;return e?(i=+t,u=+arguments[e-1],n):i},n.innerTickSize=function(t){return arguments.length?(i=+t,n):i},n.outerTickSize=function(t){return arguments.length?(u=+t,n):u},n.tickPadding=function(t){return arguments.length?(o=+t,n):o},n.tickSubdivide=function(){return arguments.length&&n},n};var Vl="bottom",Xl={top:1,right:1,bottom:1,left:1};ao.svg.brush=function(){function n(t){t.each(function(){var t=ao.select(this).style("pointer-events","all").style("-webkit-tap-highlight-color","rgba(0,0,0,0)").on("mousedown.brush",u).on("touchstart.brush",u),o=t.selectAll(".background").data([0]);o.enter().append("rect").attr("class","background").style("visibility","hidden").style("cursor","crosshair"),t.selectAll(".extent").data([0]).enter().append("rect").attr("class","extent").style("cursor","move");var a=t.selectAll(".resize").data(v,m);a.exit().remove(),a.enter().append("g").attr("class",function(n){return"resize "+n}).style("cursor",function(n){return $l[n]}).append("rect").attr("x",function(n){return/[ew]$/.test(n)?-3:null}).attr("y",function(n){return/^[ns]/.test(n)?-3:null}).attr("width",6).attr("height",6).style("visibility","hidden"),a.style("display",n.empty()?"none":null);var l,s=ao.transition(t),h=ao.transition(o);c&&(l=Zi(c),h.attr("x",l[0]).attr("width",l[1]-l[0]),r(s)),f&&(l=Zi(f),h.attr("y",l[0]).attr("height",l[1]-l[0]),i(s)),e(s)})}function e(n){n.selectAll(".resize").attr("transform",function(n){return"translate("+s[+/e$/.test(n)]+","+h[+/^s/.test(n)]+")"})}function r(n){n.select(".extent").attr("x",s[0]),n.selectAll(".extent,.n>rect,.s>rect").attr("width",s[1]-s[0])}function i(n){n.select(".extent").attr("y",h[0]),n.selectAll(".extent,.e>rect,.w>rect").attr("height",h[1]-h[0])}function u(){function u(){32==ao.event.keyCode&&(C||(M=null,L[0]-=s[1],L[1]-=h[1],C=2),S())}function v(){32==ao.event.keyCode&&2==C&&(L[0]+=s[1],L[1]+=h[1],C=0,S())}function d(){var n=ao.mouse(b),t=!1;x&&(n[0]+=x[0],n[1]+=x[1]),C||(ao.event.altKey?(M||(M=[(s[0]+s[1])/2,(h[0]+h[1])/2]),L[0]=s[+(n[0]<M[0])],L[1]=h[+(n[1]<M[1])]):M=null),E&&y(n,c,0)&&(r(k),t=!0),A&&y(n,f,1)&&(i(k),t=!0),t&&(e(k),w({type:"brush",mode:C?"move":"resize"}))}function y(n,t,e){var r,i,u=Zi(t),l=u[0],c=u[1],f=L[e],v=e?h:s,d=v[1]-v[0];return C&&(l-=f,c-=d+f),r=(e?g:p)?Math.max(l,Math.min(c,n[e])):n[e],C?i=(r+=f)+d:(M&&(f=Math.max(l,Math.min(c,2*M[e]-r))),r>f?(i=r,r=f):i=f),v[0]!=r||v[1]!=i?(e?a=null:o=null,v[0]=r,v[1]=i,!0):void 0}function m(){d(),k.style("pointer-events","all").selectAll(".resize").style("display",n.empty()?"none":null),ao.select("body").style("cursor",null),q.on("mousemove.brush",null).on("mouseup.brush",null).on("touchmove.brush",null).on("touchend.brush",null).on("keydown.brush",null).on("keyup.brush",null),z(),w({type:"brushend"})}var M,x,b=this,_=ao.select(ao.event.target),w=l.of(b,arguments),k=ao.select(b),N=_.datum(),E=!/^(n|s)$/.test(N)&&c,A=!/^(e|w)$/.test(N)&&f,C=_.classed("extent"),z=W(b),L=ao.mouse(b),q=ao.select(t(b)).on("keydown.brush",u).on("keyup.brush",v);if(ao.event.changedTouches?q.on("touchmove.brush",d).on("touchend.brush",m):q.on("mousemove.brush",d).on("mouseup.brush",m),k.interrupt().selectAll("*").interrupt(),C)L[0]=s[0]-L[0],L[1]=h[0]-L[1];else if(N){var T=+/w$/.test(N),R=+/^n/.test(N);x=[s[1-T]-L[0],h[1-R]-L[1]],L[0]=s[T],L[1]=h[R]}else ao.event.altKey&&(M=L.slice());k.style("pointer-events","none").selectAll(".resize").style("display",null),ao.select("body").style("cursor",_.style("cursor")),w({type:"brushstart"}),d()}var o,a,l=N(n,"brushstart","brush","brushend"),c=null,f=null,s=[0,0],h=[0,0],p=!0,g=!0,v=Bl[0];return n.event=function(n){n.each(function(){var n=l.of(this,arguments),t={x:s,y:h,i:o,j:a},e=this.__chart__||t;this.__chart__=t,Hl?ao.select(this).transition().each("start.brush",function(){o=e.i,a=e.j,s=e.x,h=e.y,n({type:"brushstart"})}).tween("brush:brush",function(){var e=xr(s,t.x),r=xr(h,t.y);return o=a=null,function(i){s=t.x=e(i),h=t.y=r(i),n({type:"brush",mode:"resize"})}}).each("end.brush",function(){o=t.i,a=t.j,n({type:"brush",mode:"resize"}),n({type:"brushend"})}):(n({type:"brushstart"}),n({type:"brush",mode:"resize"}),n({type:"brushend"}))})},n.x=function(t){return arguments.length?(c=t,v=Bl[!c<<1|!f],n):c},n.y=function(t){return arguments.length?(f=t,v=Bl[!c<<1|!f],n):f},n.clamp=function(t){return arguments.length?(c&&f?(p=!!t[0],g=!!t[1]):c?p=!!t:f&&(g=!!t),n):c&&f?[p,g]:c?p:f?g:null},n.extent=function(t){var e,r,i,u,l;return arguments.length?(c&&(e=t[0],r=t[1],f&&(e=e[0],r=r[0]),o=[e,r],c.invert&&(e=c(e),r=c(r)),e>r&&(l=e,e=r,r=l),e==s[0]&&r==s[1]||(s=[e,r])),f&&(i=t[0],u=t[1],c&&(i=i[1],u=u[1]),a=[i,u],f.invert&&(i=f(i),u=f(u)),i>u&&(l=i,i=u,u=l),i==h[0]&&u==h[1]||(h=[i,u])),n):(c&&(o?(e=o[0],r=o[1]):(e=s[0],r=s[1],c.invert&&(e=c.invert(e),r=c.invert(r)),e>r&&(l=e,e=r,r=l))),f&&(a?(i=a[0],u=a[1]):(i=h[0],u=h[1],f.invert&&(i=f.invert(i),u=f.invert(u)),i>u&&(l=i,i=u,u=l))),c&&f?[[e,i],[r,u]]:c?[e,r]:f&&[i,u])},n.clear=function(){return n.empty()||(s=[0,0],h=[0,0],o=a=null),n},n.empty=function(){return!!c&&s[0]==s[1]||!!f&&h[0]==h[1]},ao.rebind(n,l,"on")};var $l={n:"ns-resize",e:"ew-resize",s:"ns-resize",w:"ew-resize",nw:"nwse-resize",ne:"nesw-resize",se:"nwse-resize",sw:"nesw-resize"},Bl=[["n","e","s","w","nw","ne","se","sw"],["e","w"],["n","s"],[]],Wl=ga.format=xa.timeFormat,Jl=Wl.utc,Gl=Jl("%Y-%m-%dT%H:%M:%S.%LZ");Wl.iso=Date.prototype.toISOString&&+new Date("2000-01-01T00:00:00.000Z")?eo:Gl,eo.parse=function(n){var t=new Date(n);return isNaN(t)?null:t},eo.toString=Gl.toString,ga.second=On(function(n){return new va(1e3*Math.floor(n/1e3))},function(n,t){n.setTime(n.getTime()+1e3*Math.floor(t))},function(n){return n.getSeconds()}),ga.seconds=ga.second.range,ga.seconds.utc=ga.second.utc.range,ga.minute=On(function(n){return new va(6e4*Math.floor(n/6e4))},function(n,t){n.setTime(n.getTime()+6e4*Math.floor(t))},function(n){return n.getMinutes()}),ga.minutes=ga.minute.range,ga.minutes.utc=ga.minute.utc.range,ga.hour=On(function(n){var t=n.getTimezoneOffset()/60;return new va(36e5*(Math.floor(n/36e5-t)+t))},function(n,t){n.setTime(n.getTime()+36e5*Math.floor(t))},function(n){return n.getHours()}),ga.hours=ga.hour.range,ga.hours.utc=ga.hour.utc.range,ga.month=On(function(n){return n=ga.day(n),n.setDate(1),n},function(n,t){n.setMonth(n.getMonth()+t)},function(n){return n.getMonth()}),ga.months=ga.month.range,ga.months.utc=ga.month.utc.range;var Kl=[1e3,5e3,15e3,3e4,6e4,3e5,9e5,18e5,36e5,108e5,216e5,432e5,864e5,1728e5,6048e5,2592e6,7776e6,31536e6],Ql=[[ga.second,1],[ga.second,5],[ga.second,15],[ga.second,30],[ga.minute,1],[ga.minute,5],[ga.minute,15],[ga.minute,30],[ga.hour,1],[ga.hour,3],[ga.hour,6],[ga.hour,12],[ga.day,1],[ga.day,2],[ga.week,1],[ga.month,1],[ga.month,3],[ga.year,1]],nc=Wl.multi([[".%L",function(n){return n.getMilliseconds()}],[":%S",function(n){return n.getSeconds()}],["%I:%M",function(n){return n.getMinutes()}],["%I %p",function(n){return n.getHours()}],["%a %d",function(n){return n.getDay()&&1!=n.getDate()}],["%b %d",function(n){return 1!=n.getDate()}],["%B",function(n){return n.getMonth()}],["%Y",zt]]),tc={range:function(n,t,e){return ao.range(Math.ceil(n/e)*e,+t,e).map(io)},floor:m,ceil:m};Ql.year=ga.year,ga.scale=function(){return ro(ao.scale.linear(),Ql,nc)};var ec=Ql.map(function(n){return[n[0].utc,n[1]]}),rc=Jl.multi([[".%L",function(n){return n.getUTCMilliseconds()}],[":%S",function(n){return n.getUTCSeconds()}],["%I:%M",function(n){return n.getUTCMinutes()}],["%I %p",function(n){return n.getUTCHours()}],["%a %d",function(n){return n.getUTCDay()&&1!=n.getUTCDate()}],["%b %d",function(n){return 1!=n.getUTCDate()}],["%B",function(n){return n.getUTCMonth()}],["%Y",zt]]);ec.year=ga.year.utc,ga.scale.utc=function(){return ro(ao.scale.linear(),ec,rc)},ao.text=An(function(n){return n.responseText}),ao.json=function(n,t){return Cn(n,"application/json",uo,t)},ao.html=function(n,t){return Cn(n,"text/html",oo,t)},ao.xml=An(function(n){return n.responseXML}),"function"==typeof define&&define.amd?(this.d3=ao,define(ao)):"object"==typeof module&&module.exports?module.exports=ao:this.d3=ao}();;
/**
 * @file
 * Integrates d3 library and functionality with D7 core javascript
 */

(function($, Drupal) {

  /**
   * Global object for holding d3 internal and visualization style methods.
   */
  Drupal.d3 = {
    draw: function(element, settings) {
      // Invoke JavaScript library function, if it exists.
      var name = settings.type.toLowerCase();
      if (Drupal.d3[name]) {
        Drupal.d3[name](element, settings);
      }
    }
  };

  /**
   * Drupal behaviors for D3 module.
   */
  Drupal.behaviors.d3 = {
    attach: function(context, settings) {
      var id, $context = $(context);
      // Check to see if there are visualizations that have been set.
      if (settings.d3 && settings.d3.inventory) {
        // Iterate over each of the visualizations set in inventory.
        for (id in settings.d3.inventory) {
          // Only process the visualization once, if it exists.
          $context.find('#' + id).once('d3', function () {
            Drupal.d3.draw(id, settings.d3.inventory[id]);
          });
        }
      }
    }
  };

})(jQuery, Drupal);
;
/**
 * @file
 * Extends d3 with helper functions.
 */
(function($, Drupal, undefined) {

  Drupal.d3.helpers = Drupal.d3.helpers || {};

  /**
   * helper function to get settings from moh_d3 module.
   */
  Drupal.d3.helpers.getSettings = function (id) {
    // Global settings from module admin page.
    var d3Settings = Drupal.settings.mohD3;
    // Get settings override from table data.
    var tableId = $('#' + id).attr('data-graph-source');
    var tableSettings = {};
    // Get all data-graph attributes formated.
    $.each( $('#' + tableId).data(), function( key, value ) {
      var new_key = Drupal.d3.helpers.camelCase(key);
      if (value === 0) {
        value = '0';
      }
      tableSettings[new_key] = value;
    });
    $.extend(d3Settings, tableSettings);
    return d3Settings;
  }

  /**
   * helper function to build grid x axis.
   */
  Drupal.d3.helpers.makeXaxis = function (xScale, num) {
    return d3.svg.axis()
        .scale(xScale)
        .orient("bottom")
        .ticks(num)
  }

  /**
   * helper function to convert string list with comma to array.
   */
  Drupal.d3.helpers.comma2array = function (string) {
    return string.replace(/[\s,]+/g, ',').split(',');
  }

  /**
   * helper function to build grid y axis.
   */
  Drupal.d3.helpers.makeYaxis = function (yScale, num) {
    return d3.svg.axis()
        .scale(yScale)
        .orient("left")
        .ticks(num)
  }

  /**
   * helper function to build the legend.
   */
  Drupal.d3.helpers.legend = function (svg, w, legend, p, key, z) {
    var legend = svg.append("g")
      .attr("class", "legend")
      .attr('width', legend.w)
      .attr("transform", "translate(" + (w - legend.w) + "," + p[0] * .5 + ")");

    var keys = legend.selectAll("g")
      .data(key)
      .enter().append("g")
      .attr("transform", function(d,i) { return "translate(0," + i * 25 + ")"});
      //.attr("transform", function(d,i) { return "translate(0," + d3.tileText(d,15) + ")"});

    keys.append("rect")
      .attr("fill", function(d,i) { return d3.rgb(z(i)); })
      .attr("width", 16)
      .attr("height", 16)
      .attr("y", 0)
      .attr("x", 0);

    var labelWrapper = keys.append("g");

    labelWrapper.selectAll("text")
      .data(function(d,i) { return d3.splitString(key[i], 40); })
      .enter().append("text")
      .text(function(d,i) { return d})
      .attr("x", 20)
      .attr("y", function(d,i) { return i * 20})
      .attr("dy", "1em");
  }

  /**
   * helper function to get max values of rows.
   */
  Drupal.d3.helpers.maxValue = function (rows) {
    var data = jQuery.extend(true, [], rows);
    data = d3.merge(data);
    var max = d3.max(data.map(function(d) {
      return + d;
    }));
    return max;
  }

  /**
   * helper function to handle tooltip on column.
   */
  Drupal.d3.helpers.showToolTip = function (graph, barWidth, y, d, i, obj) {
    // Change color and style of the bar.
    var bar = d3.select(obj);
    bar.attr('stroke', '#ccc')
      .attr('stroke-width', '1')
      .attr('opacity', '0.75');

    var group = d3.select(obj.parentNode);

    var tooltip = graph.append('g')
      .attr('class', 'd3-tooltip')
      // move to the x position of the parent group
      .attr('transform', function(data) { return group.attr('transform'); })
        .append('g')
      // now move to the actual x and y of the bar within that group
      .attr('transform', function(data) { return 'translate(' + (Number(bar.attr('x')) + barWidth) + ',' + y(d) + ')'; });

    d3.tooltip(tooltip, d);
  }

  /**
   * helper function to handle tooltip on column.
   */
  Drupal.d3.helpers.hideToolTip = function (graph, d, i, obj) {
    var group = d3.select(obj.parentNode);
    var bar = d3.select(obj);
    bar.attr('stroke-width', '0')
      .attr('opacity', 1);

    graph.select('g.d3-tooltip').remove();
  }

  /**
   * helper function to format table data.
   */
  Drupal.d3.helpers.camelCase = function camelCase (string) {
    return string.replace( /-([a-z])/ig, function( all, letter ) {
        return letter.toUpperCase();
    });
  }

})(jQuery, Drupal);
;
/**
 * @file
 * Javascript for Linear.
 */

(function($, Drupal, undefined) {

  /**
   * Adds library to the global d3 object.
   *
   * @param select
   * @param settings
   *   Array of values passed to d3_draw.
   *   id: required. This will be needed to attach your
   *       visualization to the DOM.
   */
  Drupal.d3.c3 = function(select, datas) {

    // Grab our helpers function.
    var _h = Drupal.d3.helpers;
    // Get global settings merge with this current table overrides.
    var _s = _h.getSettings(datas.id);

    // Build our options to match C3 options.
    // http://c3js.org/reference.html
    var options = {
      bindto: '#' + select,
      size: {},
      data: {
        rows: datas.rows_c3,
        regions: {}
      },
      interaction: {
        enabled: (_s.graphInteraction == 1) ? true : false
      },
      padding: {},
      color: {},
      legend: {
        show: (_s.graphLegend == 1) ? true : false,
        inset: {}
      },
      tooltip: {},
      grid: {
        x: {
          show: (_s.graphGridX == 1) ? true : false
        },
        y: {
          show: (_s.graphGridY == 1) ? true : false
        },
        focus: {
          show: (_s.graphFocus == 1) ? true : false
        }
      },
      axis: {
        rotated: (_s.graphRotated == 1) ? true : false,
        x: {
          show: (_s.graphXaxisShow == 1) ? true : false,
          padding: {
            left: 0,
            right: 0,
          },
          label: {
            text: _s.graphXaxisLabel,
            position: 'outer-center'
          },
          tick: {
            outer: false,
            width: 0,
            offset: 60,
            rotate: _s.graphXaxisRotation,
            centered: _s.graphXaxisCentered
          }
        },
        y: {
          show: (_s.graphYaxisShow == 1) ? true : false,
          inverted: (_s.graphYaxisInverted == 1) ? true : false,
          label: {
            text: _s.graphYaxisLabel,
          },
          tick: {
            outer: false
          }
        }
      },
      bar: {
        width: {
          ratio: _s.graphBarRatio
        }
      },
      point: {
        show: (_s.graphDot == 1) ? true : false,
        r: _s.graphDotR
      }
    };

    // Labels data on the graph.
    if (_s.graphDataLabel == undefined) {
      _s.graphDataLabel = _s.graphDefaultDataLabel;
    }
    options.data.labels = (_s.graphDataLabel == 1) ? true : false;
    // Colors handling conditionnal option.
    if (_s.graphColors != undefined) {
      if (_s.graphColors instanceof Array) {
        options.color.pattern = _s.graphColors;
      } else {
        options.color.pattern = _h.comma2array(_s.graphColors);
      }
    } else {
      // Fallback on default colors from settings.
      options.color.pattern = _h.comma2array(_s.graphDefaultColors);
    }
    // Categories check.
    if (datas.categories == '') {
      options.axis.x.type = 'indexed';
    } else {
      options.axis.x.type = 'category';
      options.axis.x.categories = datas.categories;
    }

    /** Extra options depending table data-graph- **/
    // Tooltip.
    if (_s.graphTooltip == undefined) {
      _s.graphTooltip = _s.graphDefaultTooltip;
    }
    options.tooltip.show = _s.graphTooltip;
    // Add type override.
    if (_s.C3Types.indexOf(_s.graphRender) != -1) {
      options.data.type = _s.graphRender;
    }
    // Set graph property override.
    if (_s.graphWidth != undefined) {
      options.size.width = _s.graphWidth;
    } else if (_s.graphDefaultWidth != '') {
      options.size.width = _s.graphDefaultWidth;
    }
    if (_s.graphHeight != undefined) {
      options.size.height = _s.graphHeight;
    } else if (_s.graphDefaultHeight != '') {
      options.size.height = _s.graphDefaultHeight;
    }
    // Grid override.
    if (_s.graphGridX != undefined) {
      options.grid.x.show = _s.graphGridX;
    } else if (_s.graphDefaultGridX != '') {
      options.grid.x.show = _s.graphDefaultGridX;
    } else {
      options.grid.x.show = false;
    }
    if (_s.graphGridY != undefined) {
      options.grid.y.show = _s.graphGridY;
    } else if (_s.graphDefaultGridY != '') {
      options.grid.y.show = _s.graphDefaultGridY;
    } else {
      options.grid.y.show = false;
    }

    // Padding, optionnal as default is auto.
    if (_s.graphPadding != undefined && _s.graphPadding != '') {
      var padding = _h.comma2array(_s.graphPadding);
      options.padding = {
        top: parseInt(padding[0]),
        right: parseInt(padding[1]),
        bottom: parseInt(padding[2]),
        left: parseInt(padding[3])
      };
    }

    // Create an object of graph type if needed.
    if (_s.graphTypes != '') {
      var types = _h.comma2array(_s.graphTypes);
      var obj = {};
      for (var i = 0, l = datas.legend.length; i < l; i++) {
        if (types[i] != undefined) {
          obj[datas.legend[i]] = types[i];
        }
      }
      options.data.types = obj;
    }

    // X height
    if (_s.graphXaxisHeight != '' || _s.graphXaxisHeight != '0') {
      options.axis.x.height = _s.graphXaxisHeight;
    }
    // X ticks settings.
    if (_s.graphXaxisRotation != '' || _s.graphXaxisRotation != '0') {
      options.axis.x.tick.rotate = _s.graphXaxisRotation;
    }
    if (_s.graphXaxisCentered != '' || _s.graphXaxisCentered) {
      options.axis.x.tick.centered = _s.graphXaxisCentered;
    }
    // Sepcific legend inset break settings.
    if (_s.graphLegend) {
      if (_s.graphLegendPosition == undefined) {
        _s.graphLegendPosition = _s.graphDefaultLegendPosition;
      }
      if (_s.graphLegendPosition == 'bottom' || _s.graphLegendPosition == 'right') {
        options.legend.position = _s.graphLegendPosition;
      }
      if (_s.graphLegendPosition == 'top-right' ||
        _s.graphLegendPosition == 'bottom-right' ||
        _s.graphLegendPosition == 'top-left' ||
        _s.graphLegendPosition == 'bottom-left') {
        options.legend.position = 'inset';
        options.legend.inset = {
          anchor: _s.graphLegendPosition,
          x: 10,
          y: 0
        };
      }

      // Break column if more than x datas.
      if (datas.legend.length <= _s.graphLegendStep) {
        options.legend.inset.step = datas.legend.length;
      } else {
        options.legend.inset.step = _s.graphLegendStep;
      }
    }
    // Y axis min and max values.
    if (_s.graphYaxisMax != '') {
      options.axis.y.max = _s.graphYaxisMax;
    }
    if (_s.graphYaxisMin != '') {
      options.axis.y.min = _s.graphYaxisMin;
    }
    // Axis prefixes and suffixes.
    if (_s.graphYaxisPrefix != '' || _s.graphYaxisSuffix != '') {
      options.axis.y.tick.format = function(d) {
        return _s.graphYaxisPrefix + d + _s.graphYaxisSuffix;
      }
    }

    // Set Y center value.
    if (_s.graphYaxisCenter != '') {
      options.axis.y.center = _s.graphYaxisCenter;
    }
    // Y label position.
    if (_s.graphYaxisPosition != '') {
      options.axis.y.label.position = _s.graphYaxisPosition;
    } else {
      options.axis.y.label.position = 'outer-top';
    }
    // Group options.
    if (_s.graphGroups != '') {
      if (_s.graphGroups instanceof Array) {
        // Associate column id with data names.
        options.data.groups = (_s.graphGroups.map(function(value, index) {
          return value.map(function(d, i) {
            return datas.legend[d - 1];
          });
        }));
      }
    }
    // Y2 axis.
    if (_s.graphY2axisShow == true) {
      // Instanciate y2.
      options.axis.y2 = {
        show: _s.graphY2axisShow,
        padding: {
          top: 10,
          bottom: 10
        },
        tick: {
          outer: false
        }
      };
      if (_s.graphY2axisMax != '') {
        options.axis.y2.max = _s.graphY2axisMax;
      }
      if (_s.graphY2axisMin != '') {
        options.axis.y2.min = _s.graphY2axisMin;
      }
      if (_s.graphY2axisSource != '') {
        // Recover column name from index.
        var obj = {};
        obj[datas.legend[_s.graphY2axisSource - 1]] = 'y2';
        options.data.axes = obj;
      }
    }
    // Lines dotted.
    if (_s.graphLineDashed != undefined && _s.graphLineDashed instanceof Array) {
      var arrayLength = _s.graphLineDashed.length;
      var obj = {};
      for (var i = 0; i < arrayLength; i++) {
        // If this index exist, let set this regions dotted.
        if (datas.legend[_s.graphLineDashed[i] - 1] != undefined) {
          obj[datas.legend[_s.graphLineDashed[i] - 1]] = [{
            'style': 'dashed'
          }];
        }
      }
      options.data.regions = obj;
    }
    // Grouped tooltip option.
    if (_s.graphGroupedTooltip != undefined) {
      options.tooltip.grouped = _s.graphGroupedTooltip;
    } else {
      options.tooltip.grouped = _s.graphDefaultGroupedTooltip;
    }

    // Reset settings to avoid child heritage.
    _s.graphLegendPosition = _s.graphDefaultLegendPosition;
    _s.graphTooltip = _s.graphDefaultTooltip;
    _s.graphGroupedTooltip = _s.graphDefaultGroupedTooltip;
    _s.graphGridX = _s.graphDefaultGridX;
    _s.graphGridY = _s.graphDefaultGridY;
    _s.graphWidth = _s.graphDefaultWidth;
    _s.graphHeight = _s.graphDefaultHeight;
    _s.graphDataLabel = _s.graphDefaultDataLabel;
    _s.graphInteraction = true;
    _s.graphLegend = true;
    _s.graphRotated = false;
    _s.graphXaxisShow = true;
    _s.graphXaxisLabel = '';
    _s.graphXaxisCentered = false;
    _s.graphXaxisRotation = '';
    _s.graphXaxisHeight = '';
    _s.graphYaxisShow = true;
    _s.graphYaxisInverted = false;
    _s.graphYaxisLabel = '';
    _s.graphBarRatio = '0.9';
    _s.graphLineDotted = undefined;
    _s.graphDot = true;
    _s.graphDotR = "2.5";
    _s.graphColors = undefined;
    // Extra settings default reset.
    _s.graphRender = 'line';
    _s.graphPadding = undefined;
    _s.graphTypes = '';
    _s.graphLegendStep = 30;
    _s.graphYaxisMin = '';
    _s.graphYaxisMax = '';
    _s.graphYaxisCenter = '';
    _s.graphGroups = '';
    _s.graphY2axisShow = false;
    _s.graphY2axisMin = '';
    _s.graphY2axisMax = '';
    _s.graphY2axisSource = '';
    _s.graphFocus = true;
    _s.graphLineDashed = '';

    // Use C3 to build our graph.
    var chart = c3.generate(options);

  }

})(jQuery, Drupal);
;
/*! lazysizes - v4.0.1 */
!function(a,b){var c=b(a,a.document);a.lazySizes=c,"object"==typeof module&&module.exports&&(module.exports=c)}(window,function(a,b){"use strict";if(b.getElementsByClassName){var c,d,e=b.documentElement,f=a.Date,g=a.HTMLPictureElement,h="addEventListener",i="getAttribute",j=a[h],k=a.setTimeout,l=a.requestAnimationFrame||k,m=a.requestIdleCallback,n=/^picture$/i,o=["load","error","lazyincluded","_lazyloaded"],p={},q=Array.prototype.forEach,r=function(a,b){return p[b]||(p[b]=new RegExp("(\\s|^)"+b+"(\\s|$)")),p[b].test(a[i]("class")||"")&&p[b]},s=function(a,b){r(a,b)||a.setAttribute("class",(a[i]("class")||"").trim()+" "+b)},t=function(a,b){var c;(c=r(a,b))&&a.setAttribute("class",(a[i]("class")||"").replace(c," "))},u=function(a,b,c){var d=c?h:"removeEventListener";c&&u(a,b),o.forEach(function(c){a[d](c,b)})},v=function(a,d,e,f,g){var h=b.createEvent("CustomEvent");return e||(e={}),e.instance=c,h.initCustomEvent(d,!f,!g,e),a.dispatchEvent(h),h},w=function(b,c){var e;!g&&(e=a.picturefill||d.pf)?e({reevaluate:!0,elements:[b]}):c&&c.src&&(b.src=c.src)},x=function(a,b){return(getComputedStyle(a,null)||{})[b]},y=function(a,b,c){for(c=c||a.offsetWidth;c<d.minSize&&b&&!a._lazysizesWidth;)c=b.offsetWidth,b=b.parentNode;return c},z=function(){var a,c,d=[],e=[],f=d,g=function(){var b=f;for(f=d.length?e:d,a=!0,c=!1;b.length;)b.shift()();a=!1},h=function(d,e){a&&!e?d.apply(this,arguments):(f.push(d),c||(c=!0,(b.hidden?k:l)(g)))};return h._lsFlush=g,h}(),A=function(a,b){return b?function(){z(a)}:function(){var b=this,c=arguments;z(function(){a.apply(b,c)})}},B=function(a){var b,c=0,e=125,g=d.ricTimeout,h=function(){b=!1,c=f.now(),a()},i=m&&d.ricTimeout?function(){m(h,{timeout:g}),g!==d.ricTimeout&&(g=d.ricTimeout)}:A(function(){k(h)},!0);return function(a){var d;(a=a===!0)&&(g=33),b||(b=!0,d=e-(f.now()-c),0>d&&(d=0),a||9>d&&m?i():k(i,d))}},C=function(a){var b,c,d=99,e=function(){b=null,a()},g=function(){var a=f.now()-c;d>a?k(g,d-a):(m||e)(e)};return function(){c=f.now(),b||(b=k(g,d))}};!function(){var b,c={lazyClass:"lazyload",loadedClass:"lazyloaded",loadingClass:"lazyloading",preloadClass:"lazypreload",errorClass:"lazyerror",autosizesClass:"lazyautosizes",srcAttr:"data-src",srcsetAttr:"data-srcset",sizesAttr:"data-sizes",minSize:40,customMedia:{},init:!0,expFactor:1.5,hFac:.8,loadMode:2,loadHidden:!0,ricTimeout:300};d=a.lazySizesConfig||a.lazysizesConfig||{};for(b in c)b in d||(d[b]=c[b]);a.lazySizesConfig=d,k(function(){d.init&&F()})}();var D=function(){var g,l,m,o,p,y,D,F,G,H,I,J,K,L,M=/^img$/i,N=/^iframe$/i,O="onscroll"in a&&!/glebot/.test(navigator.userAgent),P=0,Q=0,R=0,S=-1,T=function(a){R--,a&&a.target&&u(a.target,T),(!a||0>R||!a.target)&&(R=0)},U=function(a,c){var d,f=a,g="hidden"==x(b.body,"visibility")||"hidden"!=x(a,"visibility");for(F-=c,I+=c,G-=c,H+=c;g&&(f=f.offsetParent)&&f!=b.body&&f!=e;)g=(x(f,"opacity")||1)>0,g&&"visible"!=x(f,"overflow")&&(d=f.getBoundingClientRect(),g=H>d.left&&G<d.right&&I>d.top-1&&F<d.bottom+1);return g},V=function(){var a,f,h,j,k,m,n,p,q,r=c.elements;if((o=d.loadMode)&&8>R&&(a=r.length)){f=0,S++,null==K&&("expand"in d||(d.expand=e.clientHeight>500&&e.clientWidth>500?500:370),J=d.expand,K=J*d.expFactor),K>Q&&1>R&&S>2&&o>2&&!b.hidden?(Q=K,S=0):Q=o>1&&S>1&&6>R?J:P;for(;a>f;f++)if(r[f]&&!r[f]._lazyRace)if(O)if((p=r[f][i]("data-expand"))&&(m=1*p)||(m=Q),q!==m&&(y=innerWidth+m*L,D=innerHeight+m,n=-1*m,q=m),h=r[f].getBoundingClientRect(),(I=h.bottom)>=n&&(F=h.top)<=D&&(H=h.right)>=n*L&&(G=h.left)<=y&&(I||H||G||F)&&(d.loadHidden||"hidden"!=x(r[f],"visibility"))&&(l&&3>R&&!p&&(3>o||4>S)||U(r[f],m))){if(ba(r[f]),k=!0,R>9)break}else!k&&l&&!j&&4>R&&4>S&&o>2&&(g[0]||d.preloadAfterLoad)&&(g[0]||!p&&(I||H||G||F||"auto"!=r[f][i](d.sizesAttr)))&&(j=g[0]||r[f]);else ba(r[f]);j&&!k&&ba(j)}},W=B(V),X=function(a){s(a.target,d.loadedClass),t(a.target,d.loadingClass),u(a.target,Z),v(a.target,"lazyloaded")},Y=A(X),Z=function(a){Y({target:a.target})},$=function(a,b){try{a.contentWindow.location.replace(b)}catch(c){a.src=b}},_=function(a){var b,c=a[i](d.srcsetAttr);(b=d.customMedia[a[i]("data-media")||a[i]("media")])&&a.setAttribute("media",b),c&&a.setAttribute("srcset",c)},aa=A(function(a,b,c,e,f){var g,h,j,l,o,p;(o=v(a,"lazybeforeunveil",b)).defaultPrevented||(e&&(c?s(a,d.autosizesClass):a.setAttribute("sizes",e)),h=a[i](d.srcsetAttr),g=a[i](d.srcAttr),f&&(j=a.parentNode,l=j&&n.test(j.nodeName||"")),p=b.firesLoad||"src"in a&&(h||g||l),o={target:a},p&&(u(a,T,!0),clearTimeout(m),m=k(T,2500),s(a,d.loadingClass),u(a,Z,!0)),l&&q.call(j.getElementsByTagName("source"),_),h?a.setAttribute("srcset",h):g&&!l&&(N.test(a.nodeName)?$(a,g):a.src=g),f&&(h||l)&&w(a,{src:g})),a._lazyRace&&delete a._lazyRace,t(a,d.lazyClass),z(function(){(!p||a.complete&&a.naturalWidth>1)&&(p?T(o):R--,X(o))},!0)}),ba=function(a){var b,c=M.test(a.nodeName),e=c&&(a[i](d.sizesAttr)||a[i]("sizes")),f="auto"==e;(!f&&l||!c||!a[i]("src")&&!a.srcset||a.complete||r(a,d.errorClass)||!r(a,d.lazyClass))&&(b=v(a,"lazyunveilread").detail,f&&E.updateElem(a,!0,a.offsetWidth),a._lazyRace=!0,R++,aa(a,b,f,e,c))},ca=function(){if(!l){if(f.now()-p<999)return void k(ca,999);var a=C(function(){d.loadMode=3,W()});l=!0,d.loadMode=3,W(),j("scroll",function(){3==d.loadMode&&(d.loadMode=2),a()},!0)}};return{_:function(){p=f.now(),c.elements=b.getElementsByClassName(d.lazyClass),g=b.getElementsByClassName(d.lazyClass+" "+d.preloadClass),L=d.hFac,j("scroll",W,!0),j("resize",W,!0),a.MutationObserver?new MutationObserver(W).observe(e,{childList:!0,subtree:!0,attributes:!0}):(e[h]("DOMNodeInserted",W,!0),e[h]("DOMAttrModified",W,!0),setInterval(W,999)),j("hashchange",W,!0),["focus","mouseover","click","load","transitionend","animationend","webkitAnimationEnd"].forEach(function(a){b[h](a,W,!0)}),/d$|^c/.test(b.readyState)?ca():(j("load",ca),b[h]("DOMContentLoaded",W),k(ca,2e4)),c.elements.length?(V(),z._lsFlush()):W()},checkElems:W,unveil:ba}}(),E=function(){var a,c=A(function(a,b,c,d){var e,f,g;if(a._lazysizesWidth=d,d+="px",a.setAttribute("sizes",d),n.test(b.nodeName||""))for(e=b.getElementsByTagName("source"),f=0,g=e.length;g>f;f++)e[f].setAttribute("sizes",d);c.detail.dataAttr||w(a,c.detail)}),e=function(a,b,d){var e,f=a.parentNode;f&&(d=y(a,f,d),e=v(a,"lazybeforesizes",{width:d,dataAttr:!!b}),e.defaultPrevented||(d=e.detail.width,d&&d!==a._lazysizesWidth&&c(a,f,e,d)))},f=function(){var b,c=a.length;if(c)for(b=0;c>b;b++)e(a[b])},g=C(f);return{_:function(){a=b.getElementsByClassName(d.autosizesClass),j("resize",g)},checkElems:g,updateElem:e}}(),F=function(){F.i||(F.i=!0,E._(),D._())};return c={cfg:d,autoSizer:E,loader:D,init:F,uP:w,aC:s,rC:t,hC:r,fire:v,gW:y,rAF:z}}});
;
/*! Picturefill - v2.3.1 - 2015-04-09
* http://scottjehl.github.io/picturefill
* Copyright (c) 2015 https://github.com/scottjehl/picturefill/blob/master/Authors.txt; Licensed MIT */
window.matchMedia||(window.matchMedia=function(){"use strict";var a=window.styleMedia||window.media;if(!a){var b=document.createElement("style"),c=document.getElementsByTagName("script")[0],d=null;b.type="text/css",b.id="matchmediajs-test",c.parentNode.insertBefore(b,c),d="getComputedStyle"in window&&window.getComputedStyle(b,null)||b.currentStyle,a={matchMedium:function(a){var c="@media "+a+"{ #matchmediajs-test { width: 1px; } }";return b.styleSheet?b.styleSheet.cssText=c:b.textContent=c,"1px"===d.width}}}return function(b){return{matches:a.matchMedium(b||"all"),media:b||"all"}}}()),function(a,b,c){"use strict";function d(b){"object"==typeof module&&"object"==typeof module.exports?module.exports=b:"function"==typeof define&&define.amd&&define("picturefill",function(){return b}),"object"==typeof a&&(a.picturefill=b)}function e(a){var b,c,d,e,f,i=a||{};b=i.elements||g.getAllElements();for(var j=0,k=b.length;k>j;j++)if(c=b[j],d=c.parentNode,e=void 0,f=void 0,"IMG"===c.nodeName.toUpperCase()&&(c[g.ns]||(c[g.ns]={}),i.reevaluate||!c[g.ns].evaluated)){if(d&&"PICTURE"===d.nodeName.toUpperCase()){if(g.removeVideoShim(d),e=g.getMatch(c,d),e===!1)continue}else e=void 0;(d&&"PICTURE"===d.nodeName.toUpperCase()||!g.sizesSupported&&c.srcset&&h.test(c.srcset))&&g.dodgeSrcset(c),e?(f=g.processSourceSet(e),g.applyBestCandidate(f,c)):(f=g.processSourceSet(c),(void 0===c.srcset||c[g.ns].srcset)&&g.applyBestCandidate(f,c)),c[g.ns].evaluated=!0}}function f(){function c(){clearTimeout(d),d=setTimeout(h,60)}g.initTypeDetects(),e();var d,f=setInterval(function(){return e(),/^loaded|^i|^c/.test(b.readyState)?void clearInterval(f):void 0},250),h=function(){e({reevaluate:!0})};a.addEventListener?a.addEventListener("resize",c,!1):a.attachEvent&&a.attachEvent("onresize",c)}if(a.HTMLPictureElement)return void d(function(){});b.createElement("picture");var g=a.picturefill||{},h=/\s+\+?\d+(e\d+)?w/;g.ns="picturefill",function(){g.srcsetSupported="srcset"in c,g.sizesSupported="sizes"in c,g.curSrcSupported="currentSrc"in c}(),g.trim=function(a){return a.trim?a.trim():a.replace(/^\s+|\s+$/g,"")},g.makeUrl=function(){var a=b.createElement("a");return function(b){return a.href=b,a.href}}(),g.restrictsMixedContent=function(){return"https:"===a.location.protocol},g.matchesMedia=function(b){return a.matchMedia&&a.matchMedia(b).matches},g.getDpr=function(){return a.devicePixelRatio||1},g.getWidthFromLength=function(a){var c;if(!a||a.indexOf("%")>-1!=!1||!(parseFloat(a)>0||a.indexOf("calc(")>-1))return!1;a=a.replace("vw","%"),g.lengthEl||(g.lengthEl=b.createElement("div"),g.lengthEl.style.cssText="border:0;display:block;font-size:1em;left:0;margin:0;padding:0;position:absolute;visibility:hidden",g.lengthEl.className="helper-from-picturefill-js"),g.lengthEl.style.width="0px";try{g.lengthEl.style.width=a}catch(d){}return b.body.appendChild(g.lengthEl),c=g.lengthEl.offsetWidth,0>=c&&(c=!1),b.body.removeChild(g.lengthEl),c},g.detectTypeSupport=function(b,c){var d=new a.Image;return d.onerror=function(){g.types[b]=!1,e()},d.onload=function(){g.types[b]=1===d.width,e()},d.src=c,"pending"},g.types=g.types||{},g.initTypeDetects=function(){g.types["image/jpeg"]=!0,g.types["image/gif"]=!0,g.types["image/png"]=!0,g.types["image/svg+xml"]=b.implementation.hasFeature("http://www.w3.org/TR/SVG11/feature#Image","1.1"),g.types["image/webp"]=g.detectTypeSupport("image/webp","data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=")},g.verifyTypeSupport=function(a){var b=a.getAttribute("type");if(null===b||""===b)return!0;var c=g.types[b];return"string"==typeof c&&"pending"!==c?(g.types[b]=g.detectTypeSupport(b,c),"pending"):"function"==typeof c?(c(),"pending"):c},g.parseSize=function(a){var b=/(\([^)]+\))?\s*(.+)/g.exec(a);return{media:b&&b[1],length:b&&b[2]}},g.findWidthFromSourceSize=function(c){for(var d,e=g.trim(c).split(/\s*,\s*/),f=0,h=e.length;h>f;f++){var i=e[f],j=g.parseSize(i),k=j.length,l=j.media;if(k&&(!l||g.matchesMedia(l))&&(d=g.getWidthFromLength(k)))break}return d||Math.max(a.innerWidth||0,b.documentElement.clientWidth)},g.parseSrcset=function(a){for(var b=[];""!==a;){a=a.replace(/^\s+/g,"");var c,d=a.search(/\s/g),e=null;if(-1!==d){c=a.slice(0,d);var f=c.slice(-1);if((","===f||""===c)&&(c=c.replace(/,+$/,""),e=""),a=a.slice(d+1),null===e){var g=a.indexOf(",");-1!==g?(e=a.slice(0,g),a=a.slice(g+1)):(e=a,a="")}}else c=a,a="";(c||e)&&b.push({url:c,descriptor:e})}return b},g.parseDescriptor=function(a,b){var c,d=b||"100vw",e=a&&a.replace(/(^\s+|\s+$)/g,""),f=g.findWidthFromSourceSize(d);if(e)for(var h=e.split(" "),i=h.length-1;i>=0;i--){var j=h[i],k=j&&j.slice(j.length-1);if("h"!==k&&"w"!==k||g.sizesSupported){if("x"===k){var l=j&&parseFloat(j,10);c=l&&!isNaN(l)?l:1}}else c=parseFloat(parseInt(j,10)/f)}return c||1},g.getCandidatesFromSourceSet=function(a,b){for(var c=g.parseSrcset(a),d=[],e=0,f=c.length;f>e;e++){var h=c[e];d.push({url:h.url,resolution:g.parseDescriptor(h.descriptor,b)})}return d},g.dodgeSrcset=function(a){a.srcset&&(a[g.ns].srcset=a.srcset,a.srcset="",a.setAttribute("data-pfsrcset",a[g.ns].srcset))},g.processSourceSet=function(a){var b=a.getAttribute("srcset"),c=a.getAttribute("sizes"),d=[];return"IMG"===a.nodeName.toUpperCase()&&a[g.ns]&&a[g.ns].srcset&&(b=a[g.ns].srcset),b&&(d=g.getCandidatesFromSourceSet(b,c)),d},g.backfaceVisibilityFix=function(a){var b=a.style||{},c="webkitBackfaceVisibility"in b,d=b.zoom;c&&(b.zoom=".999",c=a.offsetWidth,b.zoom=d)},g.setIntrinsicSize=function(){var c={},d=function(a,b,c){b&&a.setAttribute("width",parseInt(b/c,10))};return function(e,f){var h;e[g.ns]&&!a.pfStopIntrinsicSize&&(void 0===e[g.ns].dims&&(e[g.ns].dims=e.getAttribute("width")||e.getAttribute("height")),e[g.ns].dims||(f.url in c?d(e,c[f.url],f.resolution):(h=b.createElement("img"),h.onload=function(){if(c[f.url]=h.width,!c[f.url])try{b.body.appendChild(h),c[f.url]=h.width||h.offsetWidth,b.body.removeChild(h)}catch(a){}e.src===f.url&&d(e,c[f.url],f.resolution),e=null,h.onload=null,h=null},h.src=f.url)))}}(),g.applyBestCandidate=function(a,b){var c,d,e;a.sort(g.ascendingSort),d=a.length,e=a[d-1];for(var f=0;d>f;f++)if(c=a[f],c.resolution>=g.getDpr()){e=c;break}e&&(e.url=g.makeUrl(e.url),b.src!==e.url&&(g.restrictsMixedContent()&&"http:"===e.url.substr(0,"http:".length).toLowerCase()?void 0!==window.console&&console.warn("Blocked mixed content image "+e.url):(b.src=e.url,g.curSrcSupported||(b.currentSrc=b.src),g.backfaceVisibilityFix(b))),g.setIntrinsicSize(b,e))},g.ascendingSort=function(a,b){return a.resolution-b.resolution},g.removeVideoShim=function(a){var b=a.getElementsByTagName("video");if(b.length){for(var c=b[0],d=c.getElementsByTagName("source");d.length;)a.insertBefore(d[0],c);c.parentNode.removeChild(c)}},g.getAllElements=function(){for(var a=[],c=b.getElementsByTagName("img"),d=0,e=c.length;e>d;d++){var f=c[d];("PICTURE"===f.parentNode.nodeName.toUpperCase()||null!==f.getAttribute("srcset")||f[g.ns]&&null!==f[g.ns].srcset)&&a.push(f)}return a},g.getMatch=function(a,b){for(var c,d=b.childNodes,e=0,f=d.length;f>e;e++){var h=d[e];if(1===h.nodeType){if(h===a)return c;if("SOURCE"===h.nodeName.toUpperCase()){null!==h.getAttribute("src")&&void 0!==typeof console&&console.warn("The `src` attribute is invalid on `picture` `source` element; instead, use `srcset`.");var i=h.getAttribute("media");if(h.getAttribute("srcset")&&(!i||g.matchesMedia(i))){var j=g.verifyTypeSupport(h);if(j===!0){c=h;break}if("pending"===j)return!1}}}}return c},f(),e._=g,d(e)}(window,window.document,new window.Image);
;
/*
 * jQuery FlexSlider v2.6.4
 * Copyright 2012 WooThemes
 * Contributing Author: Tyler Smith
 */!function($){var e=!0;$.flexslider=function(t,a){var n=$(t);n.vars=$.extend({},$.flexslider.defaults,a);var i=n.vars.namespace,r=window.navigator&&window.navigator.msPointerEnabled&&window.MSGesture,s=("ontouchstart"in window||r||window.DocumentTouch&&document instanceof DocumentTouch)&&n.vars.touch,o="click touchend MSPointerUp keyup",l="",c,d="vertical"===n.vars.direction,u=n.vars.reverse,v=n.vars.itemWidth>0,p="fade"===n.vars.animation,m=""!==n.vars.asNavFor,f={};$.data(t,"flexslider",n),f={init:function(){n.animating=!1,n.currentSlide=parseInt(n.vars.startAt?n.vars.startAt:0,10),isNaN(n.currentSlide)&&(n.currentSlide=0),n.animatingTo=n.currentSlide,n.atEnd=0===n.currentSlide||n.currentSlide===n.last,n.containerSelector=n.vars.selector.substr(0,n.vars.selector.search(" ")),n.slides=$(n.vars.selector,n),n.container=$(n.containerSelector,n),n.count=n.slides.length,n.syncExists=$(n.vars.sync).length>0,"slide"===n.vars.animation&&(n.vars.animation="swing"),n.prop=d?"top":"marginLeft",n.args={},n.manualPause=!1,n.stopped=!1,n.started=!1,n.startTimeout=null,n.transitions=!n.vars.video&&!p&&n.vars.useCSS&&function(){var e=document.createElement("div"),t=["perspectiveProperty","WebkitPerspective","MozPerspective","OPerspective","msPerspective"];for(var a in t)if(void 0!==e.style[t[a]])return n.pfx=t[a].replace("Perspective","").toLowerCase(),n.prop="-"+n.pfx+"-transform",!0;return!1}(),n.ensureAnimationEnd="",""!==n.vars.controlsContainer&&(n.controlsContainer=$(n.vars.controlsContainer).length>0&&$(n.vars.controlsContainer)),""!==n.vars.manualControls&&(n.manualControls=$(n.vars.manualControls).length>0&&$(n.vars.manualControls)),""!==n.vars.customDirectionNav&&(n.customDirectionNav=2===$(n.vars.customDirectionNav).length&&$(n.vars.customDirectionNav)),n.vars.randomize&&(n.slides.sort(function(){return Math.round(Math.random())-.5}),n.container.empty().append(n.slides)),n.doMath(),n.setup("init"),n.vars.controlNav&&f.controlNav.setup(),n.vars.directionNav&&f.directionNav.setup(),n.vars.keyboard&&(1===$(n.containerSelector).length||n.vars.multipleKeyboard)&&$(document).bind("keyup",function(e){if(!$.contains(n.context,document.activeElement))return;var t=e.keyCode;if(!n.animating&&(39===t||37===t)){var a=39===t?n.getTarget("next"):37===t&&n.getTarget("prev");n.flexAnimate(a,n.vars.pauseOnAction)}}),n.vars.mousewheel&&n.bind("mousewheel",function(e,t,a,i){e.preventDefault();var r=t<0?n.getTarget("next"):n.getTarget("prev");n.flexAnimate(r,n.vars.pauseOnAction)}),n.vars.pausePlay&&f.pausePlay.setup(),n.vars.slideshow&&n.vars.pauseInvisible&&f.pauseInvisible.init(),n.vars.slideshow&&(n.vars.pauseOnHover&&n.hover(function(){n.manualPlay||n.manualPause||n.pause()},function(){n.manualPause||n.manualPlay||n.stopped||n.play()}),n.vars.pauseInvisible&&f.pauseInvisible.isHidden()||(n.vars.initDelay>0?n.startTimeout=setTimeout(n.play,n.vars.initDelay):n.play())),m&&f.asNav.setup(),s&&n.vars.touch&&f.touch(),(!p||p&&n.vars.smoothHeight)&&$(window).bind("resize orientationchange focus",f.resize()),n.find("img").attr("draggable","false"),setTimeout(function(){n.vars.start(n)},200)},asNav:{setup:function(){n.asNav=!0,n.animatingTo=Math.floor(n.currentSlide/n.move),n.currentItem=n.currentSlide,n.slides.removeClass(i+"active-slide").eq(n.currentItem).addClass(i+"active-slide"),r?(t._slider=n,n.slides.each(function(){var e=this;e._gesture=new MSGesture,e._gesture.target=e,e.addEventListener("MSPointerDown",function(e){e.preventDefault(),e.currentTarget._gesture&&e.currentTarget._gesture.addPointer(e.pointerId)},!1),e.addEventListener("MSGestureTap",function(e){e.preventDefault();var t=$(this),a=t.index();$(n.vars.asNavFor).data("flexslider").animating||t.hasClass("active")||(n.direction=n.currentItem<a?"next":"prev",n.flexAnimate(a,n.vars.pauseOnAction,!1,!0,!0))})})):n.slides.on(o,function(e){e.preventDefault();var t=$(this),a=t.index();t.offset().left-$(n).scrollLeft()<=0&&t.hasClass(i+"active-slide")?n.flexAnimate(n.getTarget("prev"),!0):$(n.vars.asNavFor).data("flexslider").animating||t.hasClass(i+"active-slide")||(n.direction=n.currentItem<a?"next":"prev",n.flexAnimate(a,n.vars.pauseOnAction,!1,!0,!0))})}},controlNav:{setup:function(){n.manualControls?f.controlNav.setupManual():f.controlNav.setupPaging()},setupPaging:function(){var e="thumbnails"===n.vars.controlNav?"control-thumbs":"control-paging",t=1,a,r;if(n.controlNavScaffold=$('<ol class="'+i+"control-nav "+i+e+'"></ol>'),n.pagingCount>1)for(var s=0;s<n.pagingCount;s++){r=n.slides.eq(s),void 0===r.attr("data-thumb-alt")&&r.attr("data-thumb-alt","");var c=""!==r.attr("data-thumb-alt")?c=' alt="'+r.attr("data-thumb-alt")+'"':"";if(a="thumbnails"===n.vars.controlNav?'<img src="'+r.attr("data-thumb")+'"'+c+"/>":'<a href="#">'+t+"</a>","thumbnails"===n.vars.controlNav&&!0===n.vars.thumbCaptions){var d=r.attr("data-thumbcaption");""!==d&&void 0!==d&&(a+='<span class="'+i+'caption">'+d+"</span>")}n.controlNavScaffold.append("<li>"+a+"</li>"),t++}n.controlsContainer?$(n.controlsContainer).append(n.controlNavScaffold):n.append(n.controlNavScaffold),f.controlNav.set(),f.controlNav.active(),n.controlNavScaffold.delegate("a, img",o,function(e){if(e.preventDefault(),""===l||l===e.type){var t=$(this),a=n.controlNav.index(t);t.hasClass(i+"active")||(n.direction=a>n.currentSlide?"next":"prev",n.flexAnimate(a,n.vars.pauseOnAction))}""===l&&(l=e.type),f.setToClearWatchedEvent()})},setupManual:function(){n.controlNav=n.manualControls,f.controlNav.active(),n.controlNav.bind(o,function(e){if(e.preventDefault(),""===l||l===e.type){var t=$(this),a=n.controlNav.index(t);t.hasClass(i+"active")||(a>n.currentSlide?n.direction="next":n.direction="prev",n.flexAnimate(a,n.vars.pauseOnAction))}""===l&&(l=e.type),f.setToClearWatchedEvent()})},set:function(){var e="thumbnails"===n.vars.controlNav?"img":"a";n.controlNav=$("."+i+"control-nav li "+e,n.controlsContainer?n.controlsContainer:n)},active:function(){n.controlNav.removeClass(i+"active").eq(n.animatingTo).addClass(i+"active")},update:function(e,t){n.pagingCount>1&&"add"===e?n.controlNavScaffold.append($('<li><a href="#">'+n.count+"</a></li>")):1===n.pagingCount?n.controlNavScaffold.find("li").remove():n.controlNav.eq(t).closest("li").remove(),f.controlNav.set(),n.pagingCount>1&&n.pagingCount!==n.controlNav.length?n.update(t,e):f.controlNav.active()}},directionNav:{setup:function(){var e=$('<ul class="'+i+'direction-nav"><li class="'+i+'nav-prev"><a class="'+i+'prev" href="#">'+n.vars.prevText+'</a></li><li class="'+i+'nav-next"><a class="'+i+'next" href="#">'+n.vars.nextText+"</a></li></ul>");n.customDirectionNav?n.directionNav=n.customDirectionNav:n.controlsContainer?($(n.controlsContainer).append(e),n.directionNav=$("."+i+"direction-nav li a",n.controlsContainer)):(n.append(e),n.directionNav=$("."+i+"direction-nav li a",n)),f.directionNav.update(),n.directionNav.bind(o,function(e){e.preventDefault();var t;""!==l&&l!==e.type||(t=$(this).hasClass(i+"next")?n.getTarget("next"):n.getTarget("prev"),n.flexAnimate(t,n.vars.pauseOnAction)),""===l&&(l=e.type),f.setToClearWatchedEvent()})},update:function(){var e=i+"disabled";1===n.pagingCount?n.directionNav.addClass(e).attr("tabindex","-1"):n.vars.animationLoop?n.directionNav.removeClass(e).removeAttr("tabindex"):0===n.animatingTo?n.directionNav.removeClass(e).filter("."+i+"prev").addClass(e).attr("tabindex","-1"):n.animatingTo===n.last?n.directionNav.removeClass(e).filter("."+i+"next").addClass(e).attr("tabindex","-1"):n.directionNav.removeClass(e).removeAttr("tabindex")}},pausePlay:{setup:function(){var e=$('<div class="'+i+'pauseplay"><a href="#"></a></div>');n.controlsContainer?(n.controlsContainer.append(e),n.pausePlay=$("."+i+"pauseplay a",n.controlsContainer)):(n.append(e),n.pausePlay=$("."+i+"pauseplay a",n)),f.pausePlay.update(n.vars.slideshow?i+"pause":i+"play"),n.pausePlay.bind(o,function(e){e.preventDefault(),""!==l&&l!==e.type||($(this).hasClass(i+"pause")?(n.manualPause=!0,n.manualPlay=!1,n.pause()):(n.manualPause=!1,n.manualPlay=!0,n.play())),""===l&&(l=e.type),f.setToClearWatchedEvent()})},update:function(e){"play"===e?n.pausePlay.removeClass(i+"pause").addClass(i+"play").html(n.vars.playText):n.pausePlay.removeClass(i+"play").addClass(i+"pause").html(n.vars.pauseText)}},touch:function(){function e(e){e.stopPropagation(),n.animating?e.preventDefault():(n.pause(),t._gesture.addPointer(e.pointerId),T=0,c=d?n.h:n.w,f=Number(new Date),l=v&&u&&n.animatingTo===n.last?0:v&&u?n.limit-(n.itemW+n.vars.itemMargin)*n.move*n.animatingTo:v&&n.currentSlide===n.last?n.limit:v?(n.itemW+n.vars.itemMargin)*n.move*n.currentSlide:u?(n.last-n.currentSlide+n.cloneOffset)*c:(n.currentSlide+n.cloneOffset)*c)}function a(e){e.stopPropagation();var a=e.target._slider;if(a){var n=-e.translationX,i=-e.translationY;if(T+=d?i:n,m=T,y=d?Math.abs(T)<Math.abs(-n):Math.abs(T)<Math.abs(-i),e.detail===e.MSGESTURE_FLAG_INERTIA)return void setImmediate(function(){t._gesture.stop()});(!y||Number(new Date)-f>500)&&(e.preventDefault(),!p&&a.transitions&&(a.vars.animationLoop||(m=T/(0===a.currentSlide&&T<0||a.currentSlide===a.last&&T>0?Math.abs(T)/c+2:1)),a.setProps(l+m,"setTouch")))}}function i(e){e.stopPropagation();var t=e.target._slider;if(t){if(t.animatingTo===t.currentSlide&&!y&&null!==m){var a=u?-m:m,n=a>0?t.getTarget("next"):t.getTarget("prev");t.canAdvance(n)&&(Number(new Date)-f<550&&Math.abs(a)>50||Math.abs(a)>c/2)?t.flexAnimate(n,t.vars.pauseOnAction):p||t.flexAnimate(t.currentSlide,t.vars.pauseOnAction,!0)}s=null,o=null,m=null,l=null,T=0}}var s,o,l,c,m,f,g,h,S,y=!1,x=0,b=0,T=0;r?(t.style.msTouchAction="none",t._gesture=new MSGesture,t._gesture.target=t,t.addEventListener("MSPointerDown",e,!1),t._slider=n,t.addEventListener("MSGestureChange",a,!1),t.addEventListener("MSGestureEnd",i,!1)):(g=function(e){n.animating?e.preventDefault():(window.navigator.msPointerEnabled||1===e.touches.length)&&(n.pause(),c=d?n.h:n.w,f=Number(new Date),x=e.touches[0].pageX,b=e.touches[0].pageY,l=v&&u&&n.animatingTo===n.last?0:v&&u?n.limit-(n.itemW+n.vars.itemMargin)*n.move*n.animatingTo:v&&n.currentSlide===n.last?n.limit:v?(n.itemW+n.vars.itemMargin)*n.move*n.currentSlide:u?(n.last-n.currentSlide+n.cloneOffset)*c:(n.currentSlide+n.cloneOffset)*c,s=d?b:x,o=d?x:b,t.addEventListener("touchmove",h,!1),t.addEventListener("touchend",S,!1))},h=function(e){x=e.touches[0].pageX,b=e.touches[0].pageY,m=d?s-b:s-x,y=d?Math.abs(m)<Math.abs(x-o):Math.abs(m)<Math.abs(b-o);var t=500;(!y||Number(new Date)-f>500)&&(e.preventDefault(),!p&&n.transitions&&(n.vars.animationLoop||(m/=0===n.currentSlide&&m<0||n.currentSlide===n.last&&m>0?Math.abs(m)/c+2:1),n.setProps(l+m,"setTouch")))},S=function(e){if(t.removeEventListener("touchmove",h,!1),n.animatingTo===n.currentSlide&&!y&&null!==m){var a=u?-m:m,i=a>0?n.getTarget("next"):n.getTarget("prev");n.canAdvance(i)&&(Number(new Date)-f<550&&Math.abs(a)>50||Math.abs(a)>c/2)?n.flexAnimate(i,n.vars.pauseOnAction):p||n.flexAnimate(n.currentSlide,n.vars.pauseOnAction,!0)}t.removeEventListener("touchend",S,!1),s=null,o=null,m=null,l=null},t.addEventListener("touchstart",g,!1))},resize:function(){!n.animating&&n.is(":visible")&&(v||n.doMath(),p?f.smoothHeight():v?(n.slides.width(n.computedW),n.update(n.pagingCount),n.setProps()):d?(n.viewport.height(n.h),n.setProps(n.h,"setTotal")):(n.vars.smoothHeight&&f.smoothHeight(),n.newSlides.width(n.computedW),n.setProps(n.computedW,"setTotal")))},smoothHeight:function(e){if(!d||p){var t=p?n:n.viewport;e?t.animate({height:n.slides.eq(n.animatingTo).innerHeight()},e):t.innerHeight(n.slides.eq(n.animatingTo).innerHeight())}},sync:function(e){var t=$(n.vars.sync).data("flexslider"),a=n.animatingTo;switch(e){case"animate":t.flexAnimate(a,n.vars.pauseOnAction,!1,!0);break;case"play":t.playing||t.asNav||t.play();break;case"pause":t.pause();break}},uniqueID:function(e){return e.filter("[id]").add(e.find("[id]")).each(function(){var e=$(this);e.attr("id",e.attr("id")+"_clone")}),e},pauseInvisible:{visProp:null,init:function(){var e=f.pauseInvisible.getHiddenProp();if(e){var t=e.replace(/[H|h]idden/,"")+"visibilitychange";document.addEventListener(t,function(){f.pauseInvisible.isHidden()?n.startTimeout?clearTimeout(n.startTimeout):n.pause():n.started?n.play():n.vars.initDelay>0?setTimeout(n.play,n.vars.initDelay):n.play()})}},isHidden:function(){var e=f.pauseInvisible.getHiddenProp();return!!e&&document[e]},getHiddenProp:function(){var e=["webkit","moz","ms","o"];if("hidden"in document)return"hidden";for(var t=0;t<e.length;t++)if(e[t]+"Hidden"in document)return e[t]+"Hidden";return null}},setToClearWatchedEvent:function(){clearTimeout(c),c=setTimeout(function(){l=""},3e3)}},n.flexAnimate=function(e,t,a,r,o){if(n.vars.animationLoop||e===n.currentSlide||(n.direction=e>n.currentSlide?"next":"prev"),m&&1===n.pagingCount&&(n.direction=n.currentItem<e?"next":"prev"),!n.animating&&(n.canAdvance(e,o)||a)&&n.is(":visible")){if(m&&r){var l=$(n.vars.asNavFor).data("flexslider");if(n.atEnd=0===e||e===n.count-1,l.flexAnimate(e,!0,!1,!0,o),n.direction=n.currentItem<e?"next":"prev",l.direction=n.direction,Math.ceil((e+1)/n.visible)-1===n.currentSlide||0===e)return n.currentItem=e,n.slides.removeClass(i+"active-slide").eq(e).addClass(i+"active-slide"),!1;n.currentItem=e,n.slides.removeClass(i+"active-slide").eq(e).addClass(i+"active-slide"),e=Math.floor(e/n.visible)}if(n.animating=!0,n.animatingTo=e,t&&n.pause(),n.vars.before(n),n.syncExists&&!o&&f.sync("animate"),n.vars.controlNav&&f.controlNav.active(),v||n.slides.removeClass(i+"active-slide").eq(e).addClass(i+"active-slide"),n.atEnd=0===e||e===n.last,n.vars.directionNav&&f.directionNav.update(),e===n.last&&(n.vars.end(n),n.vars.animationLoop||n.pause()),p)s?(n.slides.eq(n.currentSlide).css({opacity:0,zIndex:1}),n.slides.eq(e).css({opacity:1,zIndex:2}),n.wrapup(c)):(n.slides.eq(n.currentSlide).css({zIndex:1}).animate({opacity:0},n.vars.animationSpeed,n.vars.easing),n.slides.eq(e).css({zIndex:2}).animate({opacity:1},n.vars.animationSpeed,n.vars.easing,n.wrapup));else{var c=d?n.slides.filter(":first").height():n.computedW,g,h,S;v?(g=n.vars.itemMargin,S=(n.itemW+g)*n.move*n.animatingTo,h=S>n.limit&&1!==n.visible?n.limit:S):h=0===n.currentSlide&&e===n.count-1&&n.vars.animationLoop&&"next"!==n.direction?u?(n.count+n.cloneOffset)*c:0:n.currentSlide===n.last&&0===e&&n.vars.animationLoop&&"prev"!==n.direction?u?0:(n.count+1)*c:u?(n.count-1-e+n.cloneOffset)*c:(e+n.cloneOffset)*c,n.setProps(h,"",n.vars.animationSpeed),n.transitions?(n.vars.animationLoop&&n.atEnd||(n.animating=!1,n.currentSlide=n.animatingTo),n.container.unbind("webkitTransitionEnd transitionend"),n.container.bind("webkitTransitionEnd transitionend",function(){clearTimeout(n.ensureAnimationEnd),n.wrapup(c)}),clearTimeout(n.ensureAnimationEnd),n.ensureAnimationEnd=setTimeout(function(){n.wrapup(c)},n.vars.animationSpeed+100)):n.container.animate(n.args,n.vars.animationSpeed,n.vars.easing,function(){n.wrapup(c)})}n.vars.smoothHeight&&f.smoothHeight(n.vars.animationSpeed)}},n.wrapup=function(e){p||v||(0===n.currentSlide&&n.animatingTo===n.last&&n.vars.animationLoop?n.setProps(e,"jumpEnd"):n.currentSlide===n.last&&0===n.animatingTo&&n.vars.animationLoop&&n.setProps(e,"jumpStart")),n.animating=!1,n.currentSlide=n.animatingTo,n.vars.after(n)},n.animateSlides=function(){!n.animating&&e&&n.flexAnimate(n.getTarget("next"))},n.pause=function(){clearInterval(n.animatedSlides),n.animatedSlides=null,n.playing=!1,n.vars.pausePlay&&f.pausePlay.update("play"),n.syncExists&&f.sync("pause")},n.play=function(){n.playing&&clearInterval(n.animatedSlides),n.animatedSlides=n.animatedSlides||setInterval(n.animateSlides,n.vars.slideshowSpeed),n.started=n.playing=!0,n.vars.pausePlay&&f.pausePlay.update("pause"),n.syncExists&&f.sync("play")},n.stop=function(){n.pause(),n.stopped=!0},n.canAdvance=function(e,t){var a=m?n.pagingCount-1:n.last;return!!t||(!(!m||n.currentItem!==n.count-1||0!==e||"prev"!==n.direction)||(!m||0!==n.currentItem||e!==n.pagingCount-1||"next"===n.direction)&&(!(e===n.currentSlide&&!m)&&(!!n.vars.animationLoop||(!n.atEnd||0!==n.currentSlide||e!==a||"next"===n.direction)&&(!n.atEnd||n.currentSlide!==a||0!==e||"next"!==n.direction))))},n.getTarget=function(e){return n.direction=e,"next"===e?n.currentSlide===n.last?0:n.currentSlide+1:0===n.currentSlide?n.last:n.currentSlide-1},n.setProps=function(e,t,a){var i=function(){var a=e||(n.itemW+n.vars.itemMargin)*n.move*n.animatingTo;return-1*function(){if(v)return"setTouch"===t?e:u&&n.animatingTo===n.last?0:u?n.limit-(n.itemW+n.vars.itemMargin)*n.move*n.animatingTo:n.animatingTo===n.last?n.limit:a;switch(t){case"setTotal":return u?(n.count-1-n.currentSlide+n.cloneOffset)*e:(n.currentSlide+n.cloneOffset)*e;case"setTouch":return e;case"jumpEnd":return u?e:n.count*e;case"jumpStart":return u?n.count*e:e;default:return e}}()+"px"}();n.transitions&&(i=d?"translate3d(0,"+i+",0)":"translate3d("+i+",0,0)",a=void 0!==a?a/1e3+"s":"0s",n.container.css("-"+n.pfx+"-transition-duration",a),n.container.css("transition-duration",a)),n.args[n.prop]=i,(n.transitions||void 0===a)&&n.container.css(n.args),n.container.css("transform",i)},n.setup=function(e){if(p)n.slides.css({width:"100%",float:"left",marginRight:"-100%",position:"relative"}),"init"===e&&(s?n.slides.css({opacity:0,display:"block",webkitTransition:"opacity "+n.vars.animationSpeed/1e3+"s ease",zIndex:1}).eq(n.currentSlide).css({opacity:1,zIndex:2}):0==n.vars.fadeFirstSlide?n.slides.css({opacity:0,display:"block",zIndex:1}).eq(n.currentSlide).css({zIndex:2}).css({opacity:1}):n.slides.css({opacity:0,display:"block",zIndex:1}).eq(n.currentSlide).css({zIndex:2}).animate({opacity:1},n.vars.animationSpeed,n.vars.easing)),n.vars.smoothHeight&&f.smoothHeight();else{var t,a;"init"===e&&(n.viewport=$('<div class="'+i+'viewport"></div>').css({overflow:"hidden",position:"relative"}).appendTo(n).append(n.container),n.cloneCount=0,n.cloneOffset=0,u&&(a=$.makeArray(n.slides).reverse(),n.slides=$(a),n.container.empty().append(n.slides))),n.vars.animationLoop&&!v&&(n.cloneCount=2,n.cloneOffset=1,"init"!==e&&n.container.find(".clone").remove(),n.container.append(f.uniqueID(n.slides.first().clone().addClass("clone")).attr("aria-hidden","true")).prepend(f.uniqueID(n.slides.last().clone().addClass("clone")).attr("aria-hidden","true"))),n.newSlides=$(n.vars.selector,n),t=u?n.count-1-n.currentSlide+n.cloneOffset:n.currentSlide+n.cloneOffset,d&&!v?(n.container.height(200*(n.count+n.cloneCount)+"%").css("position","absolute").width("100%"),setTimeout(function(){n.newSlides.css({display:"block"}),n.doMath(),n.viewport.height(n.h),n.setProps(t*n.h,"init")},"init"===e?100:0)):(n.container.width(200*(n.count+n.cloneCount)+"%"),n.setProps(t*n.computedW,"init"),setTimeout(function(){n.doMath(),n.newSlides.css({width:n.computedW,marginRight:n.computedM,float:"left",display:"block"}),n.vars.smoothHeight&&f.smoothHeight()},"init"===e?100:0))}v||n.slides.removeClass(i+"active-slide").eq(n.currentSlide).addClass(i+"active-slide"),n.vars.init(n)},n.doMath=function(){var e=n.slides.first(),t=n.vars.itemMargin,a=n.vars.minItems,i=n.vars.maxItems;n.w=void 0===n.viewport?n.width():n.viewport.width(),n.h=e.height(),n.boxPadding=e.outerWidth()-e.width(),v?(n.itemT=n.vars.itemWidth+t,n.itemM=t,n.minW=a?a*n.itemT:n.w,n.maxW=i?i*n.itemT-t:n.w,n.itemW=n.minW>n.w?(n.w-t*(a-1))/a:n.maxW<n.w?(n.w-t*(i-1))/i:n.vars.itemWidth>n.w?n.w:n.vars.itemWidth,n.visible=Math.floor(n.w/n.itemW),n.move=n.vars.move>0&&n.vars.move<n.visible?n.vars.move:n.visible,n.pagingCount=Math.ceil((n.count-n.visible)/n.move+1),n.last=n.pagingCount-1,n.limit=1===n.pagingCount?0:n.vars.itemWidth>n.w?n.itemW*(n.count-1)+t*(n.count-1):(n.itemW+t)*n.count-n.w-t):(n.itemW=n.w,n.itemM=t,n.pagingCount=n.count,n.last=n.count-1),n.computedW=n.itemW-n.boxPadding,n.computedM=n.itemM},n.update=function(e,t){n.doMath(),v||(e<n.currentSlide?n.currentSlide+=1:e<=n.currentSlide&&0!==e&&(n.currentSlide-=1),n.animatingTo=n.currentSlide),n.vars.controlNav&&!n.manualControls&&("add"===t&&!v||n.pagingCount>n.controlNav.length?f.controlNav.update("add"):("remove"===t&&!v||n.pagingCount<n.controlNav.length)&&(v&&n.currentSlide>n.last&&(n.currentSlide-=1,n.animatingTo-=1),f.controlNav.update("remove",n.last))),n.vars.directionNav&&f.directionNav.update()},n.addSlide=function(e,t){var a=$(e);n.count+=1,n.last=n.count-1,d&&u?void 0!==t?n.slides.eq(n.count-t).after(a):n.container.prepend(a):void 0!==t?n.slides.eq(t).before(a):n.container.append(a),n.update(t,"add"),n.slides=$(n.vars.selector+":not(.clone)",n),n.setup(),n.vars.added(n)},n.removeSlide=function(e){var t=isNaN(e)?n.slides.index($(e)):e;n.count-=1,n.last=n.count-1,isNaN(e)?$(e,n.slides).remove():d&&u?n.slides.eq(n.last).remove():n.slides.eq(e).remove(),n.doMath(),n.update(t,"remove"),n.slides=$(n.vars.selector+":not(.clone)",n),n.setup(),n.vars.removed(n)},f.init()},$(window).blur(function(t){e=!1}).focus(function(t){e=!0}),$.flexslider.defaults={namespace:"flex-",selector:".slides > li",animation:"fade",easing:"swing",direction:"horizontal",reverse:!1,animationLoop:!0,smoothHeight:!1,startAt:0,slideshow:!0,slideshowSpeed:7e3,animationSpeed:600,initDelay:0,randomize:!1,fadeFirstSlide:!0,thumbCaptions:!1,pauseOnAction:!0,pauseOnHover:!1,pauseInvisible:!0,useCSS:!0,touch:!0,video:!1,controlNav:!0,directionNav:!0,prevText:"Previous",nextText:"Next",keyboard:!0,multipleKeyboard:!1,mousewheel:!1,pausePlay:!1,pauseText:"Pause",playText:"Play",controlsContainer:"",manualControls:"",customDirectionNav:"",sync:"",asNavFor:"",itemWidth:0,itemMargin:0,minItems:1,maxItems:0,move:0,allowOneSlide:!0,start:function(){},before:function(){},after:function(){},end:function(){},added:function(){},removed:function(){},init:function(){}},$.fn.flexslider=function(e){if(void 0===e&&(e={}),"object"==typeof e)return this.each(function(){var t=$(this),a=e.selector?e.selector:".slides > li",n=t.find(a);1===n.length&&!1===e.allowOneSlide||0===n.length?(n.fadeIn(400),e.start&&e.start(t)):void 0===t.data("flexslider")&&new $.flexslider(this,e)});var t=$(this).data("flexslider");switch(e){case"play":t.play();break;case"pause":t.pause();break;case"stop":t.stop();break;case"next":t.flexAnimate(t.getTarget("next"),!0);break;case"prev":case"previous":t.flexAnimate(t.getTarget("prev"),!0);break;default:"number"==typeof e&&t.flexAnimate(e,!0)}}}(jQuery);
;
(function($) {
  function mainMenuFlexBoxFix() {
    var menuItems = $('#main-menu > li:not(.visible-xs)');

    if (menuItems.length === 0) {
      return;
    }

    var menuWidth = $('#main-menu').width();

    var menuItemsWidths = [];
    var menuItemsTotalWidth = 0;
    for (var i = 0; i < menuItems.length; i++) {
      var item = $(menuItems[i]);

      var width = item.innerWidth();
      menuItemsWidths[i] = width;
      menuItemsTotalWidth += width;
    }

    for (var i = 0; i < menuItems.length; i++) {
      var item = $(menuItems[i]);
      var size = (
        100 * (
          menuItemsWidths[i] / menuWidth +
          menuItemsWidths[i] / menuItemsTotalWidth / menuItems.length
        ) + 0.05
      ) + '%';

      item.css({
        'flex-basis': size,
      });
    }

    $(menuItems[menuItems.length - 1]).css({
      'margin-right': 0
    });
  }

  $(document).ready(function() {
    mainMenuFlexBoxFix();
  });
})(window.jQuery);
;
