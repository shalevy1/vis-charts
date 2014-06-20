var UNGROUPED = '__ungrouped__'; // reserved group id for ungrouped items

function Linegraph(body, options) {
  this.id = util.randomUUID();
  this.body = body;

  this.defaultOptions = {
    yAxisOrientation: 'left',
    shaded: {
      enabled: true,
      orientation: 'top' // top, bottom
    },
    style: 'line', // line, bar
    barChart: {
      width: 50
    },
    drawPoints: {
      enabled: true,
      size: 6,
      style: 'square' // square, circle
    },
    catmullRom: {
      enabled: true,
      parametrization: 'centripetal', // uniform (alpha = 0.0), chordal (alpha = 1.0), centripetal (alpha = 0.5)
      alpha: 0.5
    },
    dataAxis: {
      showMinorLabels: true,
      showMajorLabels: true,
      majorLinesOffset: 7,
      minorLinesOffset: 4,
      labelOffsetX: 10,
      labelOffsetY: 2,
      iconWidth: 20,
      width: '40px',
      visible:true
    },
    legend: {
      enabled: true,
      axisIcons: true,
      left: {
        visible: true,
        position: 'top-left', // top/bottom - left,center,right
        textAlign: 'left'
      },
      right: {
        visible: true,
        position: 'top-left', // top/bottom - left,center,right
        textAlign: 'right'
      }
    }
  };

  // options is shared by this ItemSet and all its items
  this.options = util.extend({}, this.defaultOptions);
  this.dom = {};
  this.props = {};
  this.hammer = null;
  this.groups = {};

  var me = this;
  this.itemsData = null;    // DataSet
  this.groupsData = null;   // DataSet

  // listeners for the DataSet of the items
  this.itemListeners = {
    'add': function (event, params, senderId) {
      me._onAdd(params.items);
    },
    'update': function (event, params, senderId) {
      me._onUpdate(params.items);
    },
    'remove': function (event, params, senderId) {
      me._onRemove(params.items);
    }
  };

  // listeners for the DataSet of the groups
  this.groupListeners = {
    'add': function (event, params, senderId) {
      me._onAddGroups(params.items);
    },
    'update': function (event, params, senderId) {
      me._onUpdateGroups(params.items);
    },
    'remove': function (event, params, senderId) {
      me._onRemoveGroups(params.items);
    }
  };

  this.items = {};      // object with an Item for every data item
  this.selection = [];  // list with the ids of all selected nodes
  this.lastStart = this.body.range.start;
  this.touchParams = {}; // stores properties while dragging

  this.svgElements = {};
  this.setOptions(options);
  this.groupsUsingDefaultStyles = [0];

  var me = this;
  this.body.emitter.on("rangechange",function() {
      if (me.lastStart != 0) {
        var offset = me.body.range.start - me.lastStart;
        var range = me.body.range.end - me.body.range.start;
        if (me.width != 0) {
          var rangePerPixelInv = me.width/range;
          var xOffset = offset * rangePerPixelInv;
          me.svg.style.left = (-me.width - xOffset) + "px";
        }
      }
    });
  this.body.emitter.on("rangechanged", function() {
    me.lastStart = me.body.range.start;
    me.svg.style.left = util.option.asSize(-me.width);
    me._updateGraph.apply(me);
  });

  // create the HTML DOM
  this._create();
  this.body.emitter.emit("change");
}

Linegraph.prototype = new Component();

/**
 * Create the HTML DOM for the ItemSet
 */
Linegraph.prototype._create = function(){
  var frame = document.createElement('div');
  frame.className = 'linegraph';
  frame['linegraph'] = this;
  this.dom.frame = frame;

  // create svg element for graph drawing.
  this.svg = document.createElementNS('http://www.w3.org/2000/svg',"svg");
  this.svg.style.position = "relative";
  this.svg.style.height = "300px";
  this.svg.style.display = "block";
  frame.appendChild(this.svg);

  // panel with time axis
  this.options.dataAxis.orientation = 'left';
  this.options.dataAxis.height = this.svg.style.height;
  this.yAxisLeft = new DataAxis(this.body, this.options.dataAxis);

  this.yAxisRight = new DataAxis(this.body, {
    orientation: 'right',
    height: this.svg.style.height
  });

  this.legend = new Legend(this.body, {
    orientation:'left'
  });

  this.show();
};

/**
 * set the options of the linegraph. the mergeOptions is used for subObjects that have an enabled element.
 * @param options
 */
Linegraph.prototype.setOptions = function(options) {
  if (options) {
    var fields = ['yAxisOrientation','style','barChart','dataAxis','legend'];
    util.selectiveDeepExtend(fields, this.options, options);

    if (options.catmullRom) {
      if (typeof options.catmullRom == 'object') {
        if (options.catmullRom.parametrization) {
          if (options.catmullRom.parametrization == 'uniform') {
            this.options.catmullRom.alpha = 0;
          }
          else if (options.catmullRom.parametrization == 'chordal') {
            this.options.catmullRom.alpha = 1.0;
          }
          else {
            this.options.catmullRom.parametrization = 'centripetal';
            this.options.catmullRom.alpha = 0.5;
          }
        }
      }
    }

    util._mergeOptions(this.options, options,'catmullRom');
    util._mergeOptions(this.options, options,'drawPoints');
    util._mergeOptions(this.options, options,'shaded');
  }
};

/**
 * Hide the component from the DOM
 */
Linegraph.prototype.hide = function() {
  // remove the frame containing the items
  if (this.dom.frame.parentNode) {
    this.dom.frame.parentNode.removeChild(this.dom.frame);
  }
};

/**
 * Show the component in the DOM (when not already visible).
 * @return {Boolean} changed
 */
Linegraph.prototype.show = function() {
  // show frame containing the items
  if (!this.dom.frame.parentNode) {
    this.body.dom.center.appendChild(this.dom.frame);
  }
};


/**
 * Set items
 * @param {vis.DataSet | null} items
 */
Linegraph.prototype.setItems = function(items) {
  var me = this,
    ids,
    oldItemsData = this.itemsData;

  // replace the dataset
  if (!items) {
    this.itemsData = null;
  }
  else if (items instanceof DataSet || items instanceof DataView) {
    this.itemsData = items;
  }
  else {
    throw new TypeError('Data must be an instance of DataSet or DataView');
  }

  if (oldItemsData) {
    // unsubscribe from old dataset
    util.forEach(this.itemListeners, function (callback, event) {
      oldItemsData.off(event, callback);
    });

    // remove all drawn items
    ids = oldItemsData.getIds();
    this._onRemove(ids);
  }

  if (this.itemsData) {
    // subscribe to new dataset
    var id = this.id;
    util.forEach(this.itemListeners, function (callback, event) {
      me.itemsData.on(event, callback, id);
    });

    // add all new items
    ids = this.itemsData.getIds();
    this._onAdd(ids);
  }
  this._updateUngrouped();
  this._updateGraph();
  this.redraw();
};

/**
 * Set groups
 * @param {vis.DataSet} groups
 */
Linegraph.prototype.setGroups = function(groups) {
  var me = this,
    ids;

  // unsubscribe from current dataset
  if (this.groupsData) {
    util.forEach(this.groupListeners, function (callback, event) {
      me.groupsData.unsubscribe(event, callback);
    });

    // remove all drawn groups
    ids = this.groupsData.getIds();
    this.groupsData = null;
    this._onRemoveGroups(ids); // note: this will cause a redraw
  }

  // replace the dataset
  if (!groups) {
    this.groupsData = null;
  }
  else if (groups instanceof DataSet || groups instanceof DataView) {
    this.groupsData = groups;
  }
  else {
    throw new TypeError('Data must be an instance of DataSet or DataView');
  }

  if (this.groupsData) {
    // subscribe to new dataset
    var id = this.id;
    util.forEach(this.groupListeners, function (callback, event) {
      me.groupsData.on(event, callback, id);
    });

    // draw all ms
    ids = this.groupsData.getIds();
    this._onAddGroups(ids);
  }
  this._updateUngrouped();
  this._updateGraph();
  this.redraw();
};



Linegraph.prototype._onUpdate = function(ids) {
  this._updateUngrouped();
  this._updateGraph();
  this.redraw();
};
Linegraph.prototype._onAdd          = Linegraph.prototype._onUpdate;
Linegraph.prototype._onRemove       = Linegraph.prototype._onUpdate;
Linegraph.prototype._onUpdateGroups  = function (groupIds) {
  for (var i = 0; i < groupIds.length; i++) {
    var group = this.groupsData.get(groupIds[i]);
    if (!this.groups.hasOwnProperty(groupIds[i])) {
      this.groups[groupIds[i]] = new GraphGroup(group, this.options, this.groupsUsingDefaultStyles);
      this.legend.addGroup(groupIds[i],this.groups[groupIds[i]]);

      if (this.groups[groupIds[i]].options.yAxisOrientation == 'right') {
        this.yAxisRight.addGroup(groupIds[i], this.groups[groupIds[i]]);
      }
      else {
        this.yAxisLeft.addGroup(groupIds[i], this.groups[groupIds[i]]);
      }
    }
    else {
      this.groups[groupIds[i]].update(group);
      this.legend.updateGroup(groupIds[i],this.groups[groupIds[i]]);
      if (this.groups[groupIds[i]].options.yAxisOrientation == 'right') {
        this.yAxisRight.updateGroup(groupIds[i], this.groups[groupIds[i]]);
      }
      else {
        this.yAxisLeft.updateGroup(groupIds[i], this.groups[groupIds[i]]);
      }
    }
  }
  this._updateUngrouped();
  this._updateGraph();
  this.redraw();
};
Linegraph.prototype._onAddGroups = Linegraph.prototype._onUpdateGroups;

Linegraph.prototype._onRemoveGroups = function (groupIds) {
  for (var i = 0; i < groupIds.length; i++) {
      this.legend.removeGroup(groupIds[i]);
  }
  this._updateUngrouped();
  this._updateGraph();
  this.redraw();
};

/**
 * Create or delete the group holding all ungrouped items. This group is used when
 * there are no groups specified. This anonymous group is called 'graph'.
 * @protected
 */
Linegraph.prototype._updateUngrouped = function() {
  var group = {id: UNGROUPED, content: "graph"};
  if (!this.groups.hasOwnProperty(UNGROUPED)) {
    this.groups[UNGROUPED] = new GraphGroup(group, this.options, this.groupsUsingDefaultStyles);
    this.legend.addGroup(UNGROUPED,this.groups[UNGROUPED]);

    if (this.groups[UNGROUPED].options.yAxisOrientation == 'right') {
      this.yAxisRight.addGroup(UNGROUPED, this.groups[UNGROUPED]);
    }
    else {
      this.yAxisLeft.addGroup(UNGROUPED, this.groups[UNGROUPED]);
    }
  }
  else {
    this.groups[UNGROUPED].update(group);
    this.legend.updateGroup(UNGROUPED,this.groups[UNGROUPED]);
    if (this.groups[UNGROUPED].options.yAxisOrientation == 'right') {
      this.yAxisRight.updateGroup(UNGROUPED, this.groups[UNGROUPED]);
    }
    else {
      this.yAxisLeft.updateGroup(UNGROUPED, this.groups[UNGROUPED]);
    }
  }

  if (this.itemsData != null) {
    var datapoints = this.itemsData.get({
      filter: function (item) {return item.group === undefined;},
      showInternalIds:true
    });
    if (datapoints.length > 0) {
      var updateQuery = [];
      for (var i = 0; i < datapoints.length; i++) {
        updateQuery.push({id:datapoints[i].id, group: UNGROUPED});
      }
      this.itemsData.update(updateQuery);
    }

    var pointInUNGROUPED = this.itemsData.get({filter: function (item) {return item.group == UNGROUPED;}});
    if (pointInUNGROUPED.length == 0) {
      this.legend.deleteGroup(UNGROUPED);
      delete this.groups[UNGROUPED];
      this.yAxisLeft.yAxisRight(UNGROUPED);
      this.yAxisLeft.deleteGroup(UNGROUPED);
    }
  }
};


/**
 * Redraw the component, mandatory function
 * @return {boolean} Returns true if the component is resized
 */
Linegraph.prototype.redraw = function() {
  var resized = false;

  if (this.lastWidth === undefined && this.width || this.lastWidth != this.width) {
    resized = true;
  }
  // check if this component is resized
  resized = this._isResized() || resized;
  // check whether zoomed (in that case we need to re-stack everything)
  var visibleInterval = this.body.range.end - this.body.range.start;
  var zoomed = (visibleInterval != this.lastVisibleInterval) || (this.width != this.lastWidth);
  this.lastVisibleInterval = visibleInterval;
  this.lastWidth = this.width;

  // calculate actual size and position
  this.width = this.dom.frame.offsetWidth;

  // the svg element is three times as big as the width, this allows for fully dragging left and right
  // without reloading the graph. the controls for this are bound to events in the constructor
  if (resized == true) {
    this.svg.style.width = util.option.asSize(3*this.width);
    this.svg.style.left = util.option.asSize(-this.width);
  }
  if (zoomed == true) {
    this._updateGraph();
  }
  return resized;
};

/**
 * Update and redraw the graph.
 *
 */
Linegraph.prototype._updateGraph = function () {
  // reset the svg elements
  SVGutil._prepareSVGElements(this.svgElements);

  if (this.width != 0 && this.itemsData != null) {
    // look at different lines
    var groupIds = this.itemsData.distinct('group');
    if (groupIds.length > 0) {
      this._updateYAxis(groupIds);
      for (var i = 0; i < groupIds.length; i++) {
        this._drawGraph(groupIds[i], i, groupIds.length);
      }
    }
  }

  // this.legend.redraw();

  // cleanup unused svg elements
  SVGutil._cleanupSVGElements(this.svgElements);
};

/**
 * this sets the Y ranges for the Y axis. It also determines which of the axis should be shown or hidden.
 * @param {array} groupIds
 * @private
 */
Linegraph.prototype._updateYAxis = function(groupIds) {
  var yAxisLeftUsed = false;
  var yAxisRightUsed = false;
  var minLeft = 1e9, minRight = 1e9, maxLeft = -1e9, maxRight = -1e9, minVal, maxVal;
  var orientation = 'left';


  // if groups are present
  if (groupIds.length > 0) {
    for (var i = 0; i < groupIds.length; i++) {
      orientation = 'left';
      var group = this.groups[groupIds[i]];
      if (group.options.yAxisOrientation == 'right') {
        orientation = 'right';
      }

      var view = new vis.DataSet(this.itemsData.get({filter: function (item) {return item.group == groupIds[i];}}));
      minVal = view.min("y").y;
      maxVal = view.max("y").y;

      if (orientation == 'left') {
        yAxisLeftUsed = true;
        if (minLeft > minVal) {minLeft = minVal;}
        if (maxLeft < maxVal) {maxLeft = maxVal;}
      }
      else {
        yAxisRightUsed = true;
        if (minRight > minVal) {minRight = minVal;}
        if (maxRight < maxVal) {maxRight = maxVal;}
      }

      delete view;
    }
    if (yAxisLeftUsed == true)  {
      this.yAxisLeft.setRange({start: minLeft, end: maxLeft});
    }
    if (yAxisRightUsed == true) {
      this.yAxisRight.setRange({start: minRight, end: maxRight});
    }
  }

  var changed = this._toggleAxisVisiblity(yAxisLeftUsed, this.yAxisLeft);
  changed = this._toggleAxisVisiblity(yAxisRightUsed, this.yAxisRight) || changed;
  if (changed) {
    this.body.emitter.emit('change');
  }

  if (yAxisRightUsed == true && yAxisLeftUsed == true) {
    this.yAxisLeft.drawIcons  = true;
    this.yAxisRight.drawIcons = true;
  }
  else {
    this.yAxisLeft.drawIcons  = false;
    this.yAxisRight.drawIcons = false;
  }

  this.yAxisRight.master = !yAxisLeftUsed;

  if (this.yAxisRight.master == false) {
    if (yAxisRightUsed == true) {
      this.yAxisLeft.lineOffset = this.yAxisRight.width;
    }
    this.yAxisLeft.redraw();
    this.yAxisRight.stepPixelsForced = this.yAxisLeft.stepPixels;
    this.yAxisRight.redraw();
  }
  else {
    this.yAxisRight.redraw();
  }
}

/**
 * This shows or hides the Y axis if needed. If there is a change, the changed event is emitted by the updateYAxis function
 *
 * @param {boolean} axisUsed
 * @param {DataAxis object} axis
 * @returns {boolean}
 * @private
 */
Linegraph.prototype._toggleAxisVisiblity = function(axisUsed, axis) {
  var changed = false;
  if (axisUsed == false) {
    if (axis.dom.frame.parentNode) {
      axis.hide();
      changed = true;
    }
  }
  else {
    if (!axis.dom.frame.parentNode) {
      axis.show();
      changed = true;
    }
  }
  return changed;
}


/**
 * determine if the graph is a bar or line, get the group options and the datapoints. Then draw the graph.
 *
 * @param groupId
 * @param groupIndex
 * @param amountOfGraphs
 */
Linegraph.prototype._drawGraph = function (groupId, groupIndex, amountOfGraphs) {
  var datapoints = this.itemsData.get({filter: function (item) {return item.group == groupId;}, type: {x:"Date"}});

  // can be optimized, only has to be done once.
  var group = this.groups[groupId];

  if (group.options.style == 'line') {
    this._drawLineGraph(datapoints, group);
  }
  else {
    this._drawBarGraph(datapoints, group, amountOfGraphs);
  }
};

/**
 * draw a bar graph
 * @param datapoints
 * @param options
 * @param amountOfGraphs
 */
Linegraph.prototype._drawBarGraph = function (datapoints, group, amountOfGraphs) {
  if (datapoints != null) {
    if (datapoints.length > 0) {
      var dataset = this._prepareData(datapoints, group.options);
      var bar;
      console.log(group.options);
      for (var i = 0; i < dataset.length; i++) {
        this._drawBar(dataset[i].x, dataset[i].y, group.options.barChart.width, this.zeroPosition - dataset[i].y, group.className + ' bar');
      }

      // draw points
      if (group.options.drawPoints.enabled == true) {
        this._drawPoints(dataset, group, this.svgElements, this.svg);
      }
    }
  }
};

/**
 * draw a bar SVG element
 *
 * @param x
 * @param y
 * @param className
 */
Linegraph.prototype._drawBar = function (x, y, width, height, className) {
  rect = SVGutil._getSVGElement('rect',this.svgElements, this.svg);

  rect.setAttributeNS(null, "x", x - 0.5 * width);
  rect.setAttributeNS(null, "y", y);
  rect.setAttributeNS(null, "width", width);
  rect.setAttributeNS(null, "height", height);
  rect.setAttributeNS(null, "class", className);
};


/**
 * draw a line graph
 * 
 * @param datapoints
 * @param options
 */
Linegraph.prototype._drawLineGraph = function (datapoints, group) {
  if (datapoints != null) {
    if (datapoints.length > 0) {
      var dataset = this._prepareData(datapoints, group.options);
      var path, d;

      path = SVGutil._getSVGElement('path', this.svgElements, this.svg);
      path.setAttributeNS(null, "class", group.className);


      // construct path from dataset
      if (group.options.catmullRom.enabled == true) {
        d = this._catmullRom(dataset);
      }
      else {
        d = this._linear(dataset);
      }

      // append with points for fill and finalize the path
      if (group.options.shaded.enabled == true) {
        var fillPath = SVGutil._getSVGElement('path',this.svgElements, this.svg);
        if (group.options.shaded.orientation == 'top') {
          var dFill = "M" + dataset[0].x + "," + 0 + " " + d + "L" + dataset[dataset.length - 1].x + "," + 0;
        }
        else {
          var dFill = "M" + dataset[0].x + "," + this.svg.offsetHeight + " " + d + "L" + dataset[dataset.length - 1].x + "," + this.svg.offsetHeight;
        }
        fillPath.setAttributeNS(null, "class", group.className + " fill");
        fillPath.setAttributeNS(null, "d", dFill);
      }
      // copy properties to path for drawing.
      path.setAttributeNS(null, "d", "M" + d);

      // draw points
      if (group.options.drawPoints.enabled == true) {
        this._drawPoints(dataset, group, this.svgElements, this.svg);
      }
    }
  }
};

/**
 * draw the data points
 * 
 * @param dataset
 * @param options
 * @param JSONcontainer
 * @param svg
 */
Linegraph.prototype._drawPoints = function (dataset, group, JSONcontainer, svg) {
  for (var i = 0; i < dataset.length; i++) {
    SVGutil.drawPoint(dataset[i].x, dataset[i].y, group, JSONcontainer, svg);
  }
};



/**
 * This uses the DataAxis object to generate the correct Y coordinate on the SVG window. It uses the
 * util function toScreen to get the x coordinate from the timestamp.
 *
 * @param datapoints
 * @param options
 * @returns {Array}
 * @private
 */
Linegraph.prototype._prepareData = function (datapoints, options) {
  var extractedData = [];
  var xValue, yValue;
  var axis = this.yAxisLeft;
  var toScreen = this.body.util.toScreen;
  this.zeroPosition = 0;

  if (options.yAxisOrientation == 'right') {
    axis = this.yAxisRight;
  }
  for (var i = 0; i < datapoints.length; i++) {
    xValue = toScreen(datapoints[i].x) + this.width;
    yValue = axis.convertValue(datapoints[i].y);
    extractedData.push({x: xValue, y: yValue});
  }

  this.zeroPosition = Math.min(this.svg.offsetHeight, axis.convertValue(0));

  // extractedData.sort(function (a,b) {return a.x - b.x;});
  return extractedData;
};


/**
 * This uses an uniform parametrization of the CatmullRom algorithm:
 * "On the Parameterization of Catmull-Rom Curves" by Cem Yuksel et al.
 * @param data
 * @returns {string}
 * @private
 */
Linegraph.prototype._catmullRomUniform = function(data) {
  // catmull rom
  var p0, p1, p2, p3, bp1, bp2;
  var d = "M" + Math.round(data[0].x) + "," + Math.round(data[0].y) + " ";
  var normalization = 1/6;
  var length = data.length;
  for (var i = 0; i < length - 1; i++) {

    p0 = (i == 0) ? data[0] : data[i-1];
    p1 = data[i];
    p2 = data[i+1];
    p3 = (i + 2 < length) ? data[i+2] : p2;


    // Catmull-Rom to Cubic Bezier conversion matrix
    //    0       1       0       0
    //  -1/6      1      1/6      0
    //    0      1/6      1     -1/6
    //    0       0       1       0

    //    bp0 = { x: p1.x,                               y: p1.y };
    bp1 = { x: ((-p0.x + 6*p1.x + p2.x) *normalization), y: ((-p0.y + 6*p1.y + p2.y) *normalization)};
    bp2 = { x: (( p1.x + 6*p2.x - p3.x) *normalization), y: (( p1.y + 6*p2.y - p3.y) *normalization)};
    //    bp0 = { x: p2.x,                               y: p2.y };

    d += "C" +
      Math.round(bp1.x) + "," +
      Math.round(bp1.y) + " " +
      Math.round(bp2.x) + "," +
      Math.round(bp2.y) + " " +
      Math.round(p2.x) + "," +
      Math.round(p2.y) + " ";
  }

  return d;
};

/**
 * This uses either the chordal or centripetal parameterization of the catmull-rom algorithm.
 * By default, the centripetal parameterization is used because this gives the nicest results.
 * These parameterizations are relatively heavy because the distance between 4 points have to be calculated.
 *
 * One optimization can be used to reuse distances since this is a sliding window approach.
 * @param data
 * @returns {string}
 * @private
 */
Linegraph.prototype._catmullRom = function(data) {
  var alpha = this.options.catmullRom.alpha;
  if (alpha == 0 || alpha === undefined) {
    return this._catmullRomUniform(data);
  }
  else {
    var p0, p1, p2, p3, bp1, bp2, d1,d2,d3, A, B, N, M;
    var d3powA, d2powA, d3pow2A, d2pow2A, d1pow2A, d1powA;
    var d = "" + Math.round(data[0].x) + "," + Math.round(data[0].y) + " ";
    var length = data.length;
    for (var i = 0; i < length - 1; i++) {

      p0 = (i == 0) ? data[0] : data[i-1];
      p1 = data[i];
      p2 = data[i+1];
      p3 = (i + 2 < length) ? data[i+2] : p2;

      d1 = Math.sqrt(Math.pow(p0.x - p1.x,2) + Math.pow(p0.y - p1.y,2));
      d2 = Math.sqrt(Math.pow(p1.x - p2.x,2) + Math.pow(p1.y - p2.y,2));
      d3 = Math.sqrt(Math.pow(p2.x - p3.x,2) + Math.pow(p2.y - p3.y,2));

      // Catmull-Rom to Cubic Bezier conversion matrix
      //
      // A = 2d1^2a + 3d1^a * d2^a + d3^2a
      // B = 2d3^2a + 3d3^a * d2^a + d2^2a
      //
      // [   0             1            0          0          ]
      // [   -d2^2a/N      A/N          d1^2a/N    0          ]
      // [   0             d3^2a/M      B/M        -d2^2a/M   ]
      // [   0             0            1          0          ]

      // [   0             1            0          0          ]
      // [   -d2pow2a/N    A/N          d1pow2a/N  0          ]
      // [   0             d3pow2a/M    B/M        -d2pow2a/M ]
      // [   0             0            1          0          ]

      d3powA  = Math.pow(d3,  alpha);
      d3pow2A = Math.pow(d3,2*alpha);
      d2powA  = Math.pow(d2,  alpha);
      d2pow2A = Math.pow(d2,2*alpha);
      d1powA  = Math.pow(d1,  alpha);
      d1pow2A = Math.pow(d1,2*alpha);

      A = 2*d1pow2A + 3*d1powA * d2powA + d2pow2A;
      B = 2*d3pow2A + 3*d3powA * d2powA + d2pow2A;
      N = 3*d1powA * (d1powA + d2powA);
      if (N > 0) {N = 1 / N;}
      M = 3*d3powA * (d3powA + d2powA);
      if (M > 0) {M = 1 / M;}

      bp1 = { x: ((-d2pow2A * p0.x + A*p1.x + d1pow2A * p2.x) * N),
        y: ((-d2pow2A * p0.y + A*p1.y + d1pow2A * p2.y) * N)};

      bp2 = { x: (( d3pow2A * p1.x + B*p2.x - d2pow2A * p3.x) * M),
        y: (( d3pow2A * p1.y + B*p2.y - d2pow2A * p3.y) * M)};

      if (bp1.x == 0 && bp1.y == 0) {bp1 = p1;}
      if (bp2.x == 0 && bp2.y == 0) {bp2 = p2;}
      d += "C" +
        Math.round(bp1.x) + "," +
        Math.round(bp1.y) + " " +
        Math.round(bp2.x) + "," +
        Math.round(bp2.y) + " " +
        Math.round(p2.x) + "," +
        Math.round(p2.y) + " ";
    }

    return d;
  }
};

/**
 * this generates the SVG path for a linear drawing between datapoints.
 * @param data
 * @returns {string}
 * @private
 */
Linegraph.prototype._linear = function(data) {
  // linear
  var d = "";
  for (var i = 0; i < data.length; i++) {
    if (i == 0) {
      d += "M" + data[i].x + "," + data[i].y;
    }
    else {
      d += " " + data[i].x + "," + data[i].y;
    }
  }
  return d;
};




