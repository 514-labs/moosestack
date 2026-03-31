/*!
 * GSDevTools 3.12.2
 * https://greensock.com
 *
 * @license Copyright 2008-2023, GreenSock. All rights reserved.
 * Subject to the terms at https://greensock.com/standard-license or for
 * Club GreenSock members, the agreement issued with that membership.
 * @author: Jack Doyle, jack@greensock.com
*/

/* eslint-disable */
import { Draggable } from "./Draggable.js";

var gsap,
    _coreInitted,
    _doc,
    _docEl,
    _win,
    _recordedRoot,
    Animation,
    _rootTween,
    _rootInstance,
    _rootIsDirty,
    _keyboardInstance,
    _globalTimeline,
    _independentRoot,
    _delayedCall,
    _context,
    _recording = true,
    _startupPhase = true,
    //for the first 2 seconds, we don't record any zero-duration tweens because they're typically just setup stuff and/or the "from" or "startAt" tweens. In version 1.20.3 we started flagging those with data:"isStart"|"isFromStart" but this logic helps GSDevTools work with older versions too.
_globalStartTime = 0,
    _windowExists = function _windowExists() {
  return typeof window !== "undefined";
},
    _getGSAP = function _getGSAP() {
  return gsap || _windowExists() && (gsap = window.gsap) && gsap.registerPlugin && gsap;
},
    _isString = function _isString(value) {
  return typeof value === "string";
},
    _isFunction = function _isFunction(value) {
  return typeof value === "function";
},
    _isObject = function _isObject(value) {
  return typeof value === "object";
},
    _isUndefined = function _isUndefined(value) {
  return typeof value === "undefined";
},
    _bonusValidated = 1,
    //<name>GSDevTools</name>
_svgNS = "http://www.w3.org/2000/svg",
    _domNS = "http://www.w3.org/1999/xhtml",
    _idSeed = 0,
    //we assign an ID to each GSDevTools instance so that we can segregate the sessionStorage data accordingly.
_lookup = {},
    _supportsStorage = function () {
  try {
    sessionStorage.setItem("gsTest", "1");
    sessionStorage.removeItem("gsTest");
    return true;
  } catch (e) {
    return false;
  }
}(),
    _parseAnimation = function _parseAnimation(animationOrId) {
  return animationOrId instanceof Animation ? animationOrId : animationOrId ? gsap.getById(animationOrId) : null;
},
    _createElement = function _createElement(type, container, cssText) {
  var element = _doc.createElementNS ? _doc.createElementNS(type === "svg" ? _svgNS : _domNS, type) : _doc.createElement(type);

  if (container) {
    if (_isString(container)) {
      container = _doc.querySelector(container);
    }

    container.appendChild(element);
  }

  if (type === "svg") {
    element.setAttribute("xmlns", _svgNS);
    element.setAttribute("xmlns:xlink", _domNS);
  }

  cssText && (element.style.cssText = cssText);
  return element;
},
    _clearSelection = function _clearSelection() {
  if (_doc.selection) {
    _doc.selection.empty();
  } else if (_win.getSelection) {
    _win.getSelection().removeAllRanges();
  }
},
    _getChildrenOf = function _getChildrenOf(timeline, includeTimelines) {
  var a = [],
      cnt = 0,
      Tween = gsap.core.Tween,
      tween = timeline._first;

  while (tween) {
    if (tween instanceof Tween) {
      if (tween.vars.id) {
        a[cnt++] = tween;
      }
    } else {
      if (includeTimelines && tween.vars.id) {
        a[cnt++] = tween;
      }

      a = a.concat(_getChildrenOf(tween, includeTimelines));
      cnt = a.length;
    }

    tween = tween._next;
  }

  return a;
},
    _getClippedDuration = function _getClippedDuration(animation, excludeRootRepeats) {
  var max = 0,
      repeat = Math.max(0, animation._repeat),
      t = animation._first;

  if (!t) {
    max = animation.duration();
  }

  while (t) {
    max = Math.max(max, t.totalDuration() > 999 ? t.endTime(false) : t._start + t._tDur / t._ts);
    t = t._next;
  }

  return !excludeRootRepeats && repeat ? max * (repeat + 1) + animation._rDelay * repeat : max;
},
    _globalizeTime = function _globalizeTime(animation, rawTime) {
  var a = animation,
      time = arguments.length > 1 ? +rawTime : a.rawTime();

  while (a) {
    time = a._start + time / (a._ts || 1);
    a = a.parent;
  }

  return time;
},
    _timeToProgress = function _timeToProgress(time, animation, defaultValue, relativeProgress) {
  var add, i, a;

  if (_isString(time)) {
    if (time.charAt(1) === "=") {
      add = parseInt(time.charAt(0) + "1", 10) * parseFloat(time.substr(2));

      if (add < 0 && relativeProgress === 0) {
        //if something like inTime:"-=2", we measure it from the END, not the beginning
        relativeProgress = 100;
      }

      time = relativeProgress / 100 * animation.duration() + add;
    } else if (isNaN(time) && animation.labels && animation.labels[time] !== -1) {
      time = animation.labels[time];
    } else if (animation === _recordedRoot) {
      //perhaps they defined an id of an animation, like "myAnimation+=2"
      i = time.indexOf("=");

      if (i > 0) {
        add = parseInt(time.charAt(i - 1) + "1", 10) * parseFloat(time.substr(i + 1));
        time = time.substr(0, i - 1);
      } else {
        add = 0;
      }

      a = gsap.getById(time);

      if (a) {
        time = _globalizeTime(a, defaultValue / 100 * a.duration()) + add;
      }
    }
  }

  time = isNaN(time) ? defaultValue : parseFloat(time);
  return Math.min(100, Math.max(0, time / animation.duration() * 100));
},
    _addedCSS,
    _createRootElement = function _createRootElement(element, minimal, css) {
  if (!_addedCSS) {
    _createElement("style", _docEl).innerHTML = '.gs-dev-tools{height:51px;bottom:0;left:0;right:0;display:block;position:fixed;overflow:visible;padding:0}.gs-dev-tools *{box-sizing:content-box;visibility:visible}.gs-dev-tools .gs-top{position:relative;z-index:499}.gs-dev-tools .gs-bottom{display:flex;align-items:center;justify-content:space-between;background-color:rgba(0,0,0,.6);height:42px;border-top:1px solid #999;position:relative}.gs-dev-tools .timeline{position:relative;height:8px;margin-left:15px;margin-right:15px;overflow:visible}.gs-dev-tools .progress-bar,.gs-dev-tools .timeline-track{height:8px;width:100%;position:absolute;top:0;left:0}.gs-dev-tools .timeline-track{background-color:#999;opacity:.6}.gs-dev-tools .progress-bar{background-color:#91e600;height:8px;top:0;width:0;pointer-events:none}.gs-dev-tools .seek-bar{width:100%;position:absolute;height:24px;top:-12px;left:0;background-color:transparent}.gs-dev-tools .in-point,.gs-dev-tools .out-point{width:15px;height:26px;position:absolute;top:-18px}.gs-dev-tools .in-point-shape{fill:#6d9900;stroke:rgba(0,0,0,.5);stroke-width:1}.gs-dev-tools .out-point-shape{fill:#994242;stroke:rgba(0,0,0,.5);stroke-width:1}.gs-dev-tools .in-point{transform:translateX(-100%)}.gs-dev-tools .out-point{left:100%}.gs-dev-tools .grab{stroke:rgba(255,255,255,.3);stroke-width:1}.gs-dev-tools .playhead{position:absolute;top:-5px;transform:translate(-50%,0);left:0;border-radius:50%;width:16px;height:16px;border:1px solid #6d9900;background-color:#91e600}.gs-dev-tools .gs-btn-white{fill:#fff}.gs-dev-tools .pause{opacity:0}.gs-dev-tools .select-animation{vertical-align:middle;position:relative;padding:6px 10px}.gs-dev-tools .select-animation-container{flex-grow:4;width:40%}.gs-dev-tools .select-arrow{display:inline-block;width:12px;height:7px;margin:0 7px;transform:translate(0,-2px)}.gs-dev-tools .select-arrow-shape{stroke:rgba(255,255,255,.6);stroke-width:2px;fill:none}.gs-dev-tools .rewind{height:16px;width:19px;padding:10px 4px;min-width:24px}.gs-dev-tools .rewind-path{opacity:.6}.gs-dev-tools .play-pause{width:24px;height:24px;padding:6px 10px;min-width:24px}.gs-dev-tools .ease{width:30px;height:30px;padding:10px;min-width:30px;display:none}.gs-dev-tools .ease-path{fill:none;stroke:rgba(255,255,255,.6);stroke-width:2px}.gs-dev-tools .ease-border{fill:rgba(255,255,255,.25)}.gs-dev-tools .time-scale{font-family:monospace;font-size:18px;text-align:center;color:rgba(255,255,255,.6);padding:4px 4px 4px 0;min-width:30px;margin-left:7px}.gs-dev-tools .loop{width:20px;padding:5px;min-width:20px}.gs-dev-tools .loop-path{fill:rgba(255,255,255,.6)}.gs-dev-tools label span{color:#fff;font-family:monospace;text-decoration:none;font-size:16px;line-height:18px}.gs-dev-tools .time-scale span{color:rgba(255,255,255,.6)}.gs-dev-tools button:focus,.gs-dev-tools select:focus{outline:0}.gs-dev-tools label{position:relative;cursor:pointer}.gs-dev-tools label.locked{text-decoration:none;cursor:auto}.gs-dev-tools label input,.gs-dev-tools label select{position:absolute;left:0;top:0;z-index:1;font:inherit;font-size:inherit;line-height:inherit;height:100%;width:100%;color:#000!important;opacity:0;background:0 0;border:none;padding:0;margin:0;-webkit-appearance:none;-moz-appearance:none;appearance:none;cursor:pointer}.gs-dev-tools label input+.display{position:relative;z-index:2}.gs-dev-tools .gs-bottom-right{vertical-align:middle;display:flex;align-items:center;flex-grow:4;width:40%;justify-content:flex-end}.gs-dev-tools .time-container{font-size:18px;font-family:monospace;color:rgba(255,255,255,.6);margin:0 5px}.gs-dev-tools .logo{width:32px;height:32px;position:relative;top:2px;margin:0 12px}.gs-dev-tools .gs-hit-area{background-color:transparent;width:100%;height:100%;top:0;position:absolute}.gs-dev-tools.minimal{height:auto;display:flex;align-items:stretch}.gs-dev-tools.minimal .gs-top{order:2;flex-grow:4;background-color:rgba(0,0,0,1)}.gs-dev-tools.minimal .gs-bottom{background-color:rgba(0,0,0,1);border-top:none}.gs-dev-tools.minimal .timeline{top:50%;transform:translate(0,-50%)}.gs-dev-tools.minimal .in-point,.gs-dev-tools.minimal .out-point{display:none}.gs-dev-tools.minimal .select-animation-container{display:none}.gs-dev-tools.minimal .rewind{display:none}.gs-dev-tools.minimal .play-pause{width:20px;height:20px;padding:4px 6px;margin-left:14px}.gs-dev-tools.minimal .time-scale{min-width:26px}.gs-dev-tools.minimal .loop{width:18px;min-width:18px;display:none}.gs-dev-tools.minimal .gs-bottom-right{display:none}@media only screen and (max-width:600px){.gs-dev-tools{height:auto;display:flex;align-items:stretch}.gs-dev-tools .gs-top{order:2;flex-grow:4;background-color:rgba(0,0,0,1);height:42px}.gs-dev-tools .gs-bottom{background-color:rgba(0,0,0,1);border-top:none}.gs-dev-tools .timeline{top:50%;transform:translate(0,-50%)}.gs-dev-tools .in-point,.gs-dev-tools .out-point{display:none}.gs-dev-tools .select-animation-container{display:none}.gs-dev-tools .rewind{display:none}.gs-dev-tools .play-pause{width:20px;height:20px;padding:4px 6px;margin-left:14px}.gs-dev-tools .time-scale{min-width:26px}.gs-dev-tools .loop{width:18px;min-width:18px;display:none}.gs-dev-tools .gs-bottom-right{display:none}}';
    _addedCSS = true;
  }

  if (_isString(element)) {
    element = _doc.querySelector(element);
  }

  var root = _createElement("div", element || _docEl.getElementsByTagName("body")[0] || _docEl);

  root.setAttribute("class", "gs-dev-tools" + (minimal ? " minimal" : ""));
  root.innerHTML = '<div class=gs-hit-area></div><div class=gs-top><div class=timeline><div class=timeline-track></div><div class=progress-bar></div><div class=seek-bar></div><svg class=in-point viewBox="0 0 15 26" xmlns=http://www.w3.org/2000/svg><polygon class=in-point-shape points=".5 .5 14.5 .5 14.5 25.5 .5 17.5"/><polyline class=grab points="5.5 4 5.5 15"/><polyline class=grab points="9.5 4 9.5 17"/></svg><svg class=out-point viewBox="0 0 15 26" xmlns=http://www.w3.org/2000/svg><polygon class=out-point-shape points=".5 .5 14.5 .5 14.5 17.5 .5 25.5"/><polyline class=grab points="5.5 4 5.5 17"/><polyline class=grab points="9.5 4 9.5 15"/></svg><div class=playhead></div></div></div><div class=gs-bottom><div class=select-animation-container><label class=select-animation><select class=animation-list><option>Global Timeline<option>myTimeline</select><nobr><span class="display animation-label">Global Timeline</span><svg class=select-arrow viewBox="0 0 12.05 6.73" xmlns=http://www.w3.org/2000/svg><polyline class=select-arrow-shape points="0.35 0.35 6.03 6.03 11.7 0.35"/></svg></nobr></label></div><svg class=rewind viewBox="0 0 12 15.38" xmlns=http://www.w3.org/2000/svg><path d=M0,.38H2v15H0Zm2,7,10,7.36V0Z class="gs-btn-white rewind-path"/></svg><svg class=play-pause viewBox="0 0 20.97 25.67" xmlns=http://www.w3.org/2000/svg><g class=play><path d="M8,4.88 C8,10.18 8,15.48 8,20.79 5.33,22.41 2.66,24.04 0,25.67 0,17.11 0,8.55 0,0 2.66,1.62 5.33,3.25 8,4.88" class="gs-btn-white play-1" style=stroke:#fff;stroke-width:.6px /><path d="M14.485,8.855 C16.64,10.18 18.8,11.5 20.97,12.83 16.64,15.48 12.32,18.13 8,20.79 8,15.48 8,10.18 8,4.88 10.16,6.2 12.32,7.53 14.48,8.85" class="gs-btn-white play-2" style=stroke:#fff;stroke-width:.6px /></g></svg> <svg class=loop viewBox="0 0 29 25.38" xmlns=http://www.w3.org/2000/svg><path d=M27.44,5.44,20.19,0V3.06H9.06A9.31,9.31,0,0,0,0,12.41,9.74,9.74,0,0,0,.69,16l3.06-2.23a6,6,0,0,1-.12-1.22,5.49,5.49,0,0,1,5.43-5.5H20.19v3.81Z class=loop-path /><path d=M25.25,11.54a5.18,5.18,0,0,1,.12,1.12,5.41,5.41,0,0,1-5.43,5.41H9.19V14.5L1.94,19.94l7.25,5.44V22.06H19.94A9.2,9.2,0,0,0,29,12.84a9.42,9.42,0,0,0-.68-3.53Z class=loop-path /></svg> <svg class=ease viewBox="0 0 25.67 25.67" xmlns=http://www.w3.org/2000/svg><path d=M.48,25.12c1.74-3.57,4.28-12.6,8.8-10.7s4.75,1.43,6.5-1.11S19.89,1.19,25.2.55 class=ease-path /><path d=M24.67,1V24.67H1V1H24.67m1-1H0V25.67H25.67V0Z class=ease-border /></svg><label class=time-scale><select><option value=10>10x<option value=5>5x<option value=2>2x<option value=1 selected>1x<option value=0.5>0.5x<option value=0.25>0.25x<option value=0.1>0.1x</select><span class="display time-scale-label">1x</span></label><div class=gs-bottom-right><div class=time-container><span class=time>0.00</span> / <span class=duration>0.00</span></div><a href="https://greensock.com/docs/v3/Plugins/GSDevTools?source=GSDevTools" target=_blank title=Docs><svg class=logo viewBox="0 0 100 100" xmlns=http://www.w3.org/2000/svg><path d="M60 15.4c-.3-.4-.5-.6-.5-.7.1-.6.2-1 .2-1.7v-.4c.6.6 1.3 1.3 1.8 1.7.2.2.5.3.8.3.2 0 .3 0 .5.1h1.6c.8 0 1.6.1 2 0 .1 0 .2 0 .3-.1.6-.3 1.4-1 2.1-1.6 0 .6.1 1.2.1 1.7v1.5c0 .3 0 .5.1.7-.1.1-.2.1-.4.2-.7.4-1.7 1-2.3.9-.5-.1-1.5-.3-2.6-.7-1.2-.3-2.4-.8-3.2-1.2 0 0-.1 0-.1-.1s-.2-.4-.4-.6zm24.6 21.9c-.5-1.7-1.9-2-4.2-.7.9-1.5 2.1-1.5 2.3-2.1.9-2.5-.6-4.6-1.2-5.3.7-1.8 1.4-4.5-1-6.8-1-1-2.4-1.2-3.6-1.1 1.8 1.7 3.4 4.4 2.5 7.2-.1.3-.9.7-1.7 1 0 0 .4 2-.3 3.5-.3.6-.8 1.5-1.3 2.6 1 .9 1.6 1 3 1.3-.9.1-1.2.4-1.2.5-.7 3 1 3.4 1.4 4.8 0 .1 0 .2.1.3v.4c-.3.3-1.4.5-2.5.5s-1.8 1-1.8 1c-.2.1-.3.3-.4.4v1c0 .1 0 .4.1.6.1.5.3 1.3.4 1.8.9.6 1.4.9 2.2 1.1.5.1 1 .2 1.5.1.3-.1.7-.3 1-.7 1.5-1.7 1.9-3.2 2.2-4.1 0-.1 0-.2.1-.2 0 .1.1.1.1.2 0 0 .1-.1.1-.2l.1-.1c1.3-1.6 2.9-4.5 2.1-7zM74.3 49.9c-.1-.3-.1-.7-.2-1.1v-.2c-.1-.2-.1-.4-.2-.6 0-.1-.1-.3-.1-.5s-.1-.5-.1-.7v-.1c0-.2-.1-.5-.1-.7-.1-.3-.1-.7-.2-1.1v-.1c0-.2 0-.3-.1-.5v-.9c0-.1 0-.2.1-.3V43h-.3c-1.1.1-3.8.4-6.7.2-1.2-.1-2.4-.3-3.6-.6-1-.3-1.8-.5-2.3-.7-1.2-.4-1.6-.6-1.8-.7 0 .2-.1.4-.1.7 0 .3-.1.5-.1.8-.1.2-.1.4-.2.6l.1.1c.5.5 1.5 1.3 1.5 2.1v.2c-.1.4-.4.5-.8.9-.1.1-.6.7-1.1 1.1l-.6.6c-.1 0-.1.1-.2.1-.1.1-.3.2-.4.3-.2.1-.7.5-.8.6-.1.1-.2.1-.3.1-2.8 8.8-2.2 13.5-1.5 16.1.1.5.3 1 .4 1.3-.4.5-.8 1-1.2 1.4-1.2 1.5-2 2.6-2.6 4.2 0 .1 0 .1-.1.2 0 .1 0 .2-.1.2-.2.5-.3 1-.4 1.5-.6 2.3-.8 4.5-.9 6.6-.1 2.4-.2 4.6-.5 6.9.7.3 3.1.9 4.7.6.2-.1 0-3.9.6-5.7l.6-1.5c.4-.9.9-1.9 1.3-3.1.3-.7.5-1.5.7-2.4.1-.5.2-1 .3-1.6V74v-.1c.1-.6.1-1.3.1-2 0-.2-.7.3-1.1.9.3-1.8 1.3-2.1 2-3.2.3-.5.6-1.1.6-2 2.5-1.7 4-3.7 5-5.7.2-.4.4-.9.6-1.4.3-.8.5-1.6.7-2.4.3-1.4.8-3.2 1.2-4.8v-.1c.4-1.2.8-2.2 1.2-2.6-.2.9-.4 1.7-.6 2.5v.2c-.6 3.5-.7 6.2-2 9.2 1 2.6 1.9 3.9 2 7.6-2 0-3.2 1.6-3.7 3.2 1.2.3 3.9.7 8.3.1h.3c.1-.5.3-1.1.5-1.5.3-.8.5-1.5.6-2.2.2-1.3.1-2.4 0-3.2 3.9-3.7 2.6-11 1.6-16.6zm.3-15.1c.1-.3.2-.6.4-.8.2-.3.3-.7.5-1 .1-.3.3-.6.4-.9.5-1.5.4-2.8.3-3.5-.1 0-.1-.1-.2-.1-.5-.2-.9-.4-1.4-.6-.1 0-.2-.1-.3-.1-3.8-1.2-7.9-.9-11.9.1-1 .2-1.9.5-2.9.1-2.3-.8-3.9-1.9-4.6-2.8l-.2-.2c-.1.2-.2.4-.4.6.2 2.3-.5 3.9-1.4 5.1.9 1.2 2.6 2.8 3.6 3.4 1.1.6 1.7.7 3.4.4-.6.7-1.1 1-1.9 1.4.1.7.2 2 .5 3.4.3.3 1.2.8 2.3 1.3.5.3 1.1.5 1.7.7.8.3 1.7.6 2.4.8.1 0 .2.1.3.1.5.1 1.1.2 1.8.2h.9c2.1 0 4.5-.2 5.4-.3h.1c-.1-2.7.2-4.6.7-6.2.2-.3.4-.7.5-1.1zm-23.2 9.3v.2c-.3 1.7.5 2.4 1.9 3.4.6.5 0 .5.5.8.3.2.7.3 1 .3.3 0 .5 0 .8-.1.2-.1.4-.3.6-.5.1-.1.3-.2.5-.4.3-.2.6-.5.7-.6.1-.1.2-.1.3-.2.2-.2.5-.5.6-.7.2-.2.4-.5.5-.7 0-.1.1-.1.1-.1v-.1c.1-.4-.3-.8-.8-1.3-.2-.2-.4-.3-.5-.5-.3-.3-.6-.5-1-.7-.9-.5-1.9-.7-3-.7l-.3-.3c-2.2-2.5-3.2-4.8-3.9-6.5-.9-2.1-1.9-3.3-3.9-4.9 1 .4 1.8.8 2.3 1.1.5.4 1.3.4 1.9.2.2-.1.5-.2.7-.3.2-.1.4-.2.6-.4 1.6-1.3 2.5-3.8 2.6-5.6v-.1c.2-.3.6-1.1.8-1.4l.1.1c.1.1.3.2.6.5.1 0 .1.1.2.1.1.1.2.1.2.2.8.6 1.9 1.3 2.6 1.7 1.4.7 2.3.7 5.3-.1 2.2-.6 4.8-.8 6.8-.8 1.4 0 2.7.3 4 .7.2.1.4.1.5.2.3.1.6.2.9.4 0 0 .1 0 .1.1.8.4 2.1 1.2 2.5-.3.1-2-.6-3.9-1.6-5.3 0 0-.1 0-.1-.1-.1-.1-.2-.2-.4-.3-.1-.1-.2-.1-.3-.2-.1-.1-.2-.2-.4-.2-.6-.4-1.2-.8-1.6-.9-.1-.1-.3-.1-.4-.2h-.1-.1c-.1 0-.3-.1-.4-.1-.1 0-.1 0-.2-.1h-.1l-.2-.4c-.2-.1-.4-.2-.5-.2h-.6c-.3 0-.5.1-.7.1-.7.1-1.2.3-1.7.4-.2 0-.3.1-.5.1-.5.1-1 .2-1.6.2-.4 0-.9-.1-1.5-.2-.4-.1-.8-.2-1.1-.3-.2-.1-.4-.1-.6-.2-.6-.2-1.1-.3-1.7-.4h-.2-1.8c-.3 0-.6.1-1 .1H57.9c-.8 0-1.5 0-2.3-.1-.2 0-.5-.1-.7-.1-.5-.1-.9-.2-1.3-.4-.2-.1-.3-.1-.4-.2-.1 0-.2 0-.2-.1-.3-.1-.6-.1-.9-.1H51h-.1c-.4 0-.9.1-1.4.2-1.1.2-2.1.6-3 1.3-.3.2-.6.5-.8.8-.1.1-.2.2-.2.3-.4.6-.8 1.2-.9 2 0 .2-.1.4-.1.6 0 .2 1.7.7 2.3 2.8-.8-1.2-2.3-2.5-4.1-1.4-1.5 1-1.1 3.1-2.4 5.4-.3.5-.6.9-1 1.4-.8 1-.7 2.1.2 4.4 1.4 3.4 7.6 5.3 11.5 8.3l.4.4zm8.7-36.3c0 .6.1 1 .2 1.6v.1c0 .3.1.6.1.9.1 1.2.4 2 1 2.9 0 .1.1.1.1.2.3.2.5.3.8.4 1.1.2 3.1.3 4.2 0 .2-.1.5-.3.7-.5.4-.4.7-1.1.9-1.7.1-.7.3-1.3.4-1.8 0-.2.1-.4.1-.5v-.1c0-.2 0-.3.1-.5.2-.7.2-2.4.3-2.8.1-.7 0-1.8-.1-2.5 0-.2-.1-.4-.1-.5v-.1c-.2-.5-1.4-1.4-4.3-1.4-3.1 0-4 1-4.1 1.5v.1c0 .1 0 .3-.1.5-.1.4-.2 1.4-.2 1.9v2.3zm-6 88.6c0-.1-.1-.2-.1-.3-.7-1.5-1.1-3.5-1.3-4.6.4.1.7.6.8.3.2-.5-.4-1.5-.5-2.2v-.1c-.5-.5-4-.5-3.7-.3-.4.8-1 .6-1.3 2.1-.1.7.8.1 1.7.1-1.4.9-3 2.1-3.4 3.2-.1.1-.1.2-.1.3 0 .2-.1.4-.1.5-.1 1.2.5 1.6 2 2.4H48.4c1.4.3 3 .3 4.3.3 1.2-.2 1.6-.7 1.6-1.4-.2-.1-.2-.2-.2-.3z" style=fill:#efefef /><path d="M56.1 36.5c.3 1.4.5 2.4.8 4.2h-.2c-.1.5-.1.9-.1 1.3-1-.4-2.2-.5-2.6-.5-3.7-4.4-2.9-6.1-4.4-8.3.4-.2 1-.4 1.5-.8 1.6 1.9 3.3 3 5 4.1zm-1.7 13.2s-1.4 0-2.3-1c0 0-.1-.5.1-.7 0 0-1.2-1-1.5-1.7-.2-.5-.3-1.1-.2-1.6-4.4-3.7-10.9-4.2-12.9-9.1-.5-1.2-1.3-2.9-.9-3.9-.3.1-.5.2-.8.3-2.9.9-11.7 5.3-17.9 8.8 1.6 1.7 2.6 4.3 3.2 7.2l.3 1.5c.1.5.1 1 .2 1.5.1 1.4.4 2.7.8 3.9.2.8.6 1.5.9 2.2.6 1 1.2 1.9 2.1 2.6.6.5 1.2.9 1.9 1.3 2.1 1.1 5 1.6 8.6 1.5H37.9c.5 0 1 .1 1.5.1h.1c.4.1.9.1 1.3.2h.2c.4.1.9.2 1.3.4h.1c.4.1.8.3 1.1.5h.1c.4.2.7.4 1.1.6h.1c.7.4 1.3.9 1.9 1.5l.1.1c.6.5 1.1 1.1 1.5 1.8 0 .1.1.1.1.2s.1.1.1.2c.4.6 1.2 1.1 1.9 1.3.7-.9 1.5-1.8 2.2-2.8-1.6-6 0-11.7 1.8-16.9zm-26-15.9c5-2.4 9-4.1 9.9-4.5.3-.6.6-1.4.9-2.6.1-.3.2-.5.3-.8 1-2.7 2.7-2.8 3.5-3v-.2c.1-1.1.5-2 1-2.8-8.8 2.5-18 5.5-28 11.7-.1.1-.2.2-.4.2C11.3 34.5 3 40.3 1.3 51c2.4-2.7 6-5.6 10.5-8.5.1-.1.3-.2.5-.3.2-.1.5-.3.7-.4 1.2-.7 2.4-1.4 3.6-2.2 2.2-1.2 4.5-2.4 6.7-3.5 1.8-.8 3.5-1.6 5.1-2.3zm54.9 61.3l-.3-.3c-.8-.6-4.1-1.2-5.5-2.3-.4-.3-1.1-.7-1.7-1.1-1.6-.9-3.5-1.8-3.5-2.1v-.1c-.2-1.7-.2-7 .1-8.8.3-1.8.7-4.4.8-5.1.1-.6.5-1.2.1-1.2h-.4c-.2 0-.4.1-.8.1-1.5.3-4.3.6-6.6.4-.9-.1-1.6-.2-2-.3-.5-.1-.7-.2-.9-.3H62.3c-.4.5 0 2.7.6 4.8.3 1.1.8 2 1.2 3 .3.8.6 1.8.8 3.1 0 .2.1.4.1.7.2 2.8.3 3.6-.2 4.9-.1.3-.3.6-.4 1-.4.9-.7 1.7-.6 2.3 0 .2.1.4.1.5.2.4.6.7 1.2.8.2 0 .3.1.5.1.3 0 .6.1.9.1 3.4 0 5.2 0 8.6.4 2.5.4 3.9.6 5.1.5.4 0 .9-.1 1.4-.1 1.2-.2 1.8-.5 1.9-.9-.1.2-.1.1-.2-.1zM60.2 16.4zm-.5 1.7zm3.8.5c.1 0 .3.1.5.1.4.1.7.2 1.2.3.3.1.6.1.9.1h1.3c.3-.1.7-.1 1-.2.7-.2 1.5-.4 2.7-.6h.3c.3 0 .6.1.9.3.1.1.2.1.4.2.3.2.8.2 1.2.4h.1c.1 0 .1.1.2.1.6.3 1.3.7 1.9 1.1l.3.3c.9-.1 1.6-.2 2.1-.2h.1c-.2-.4-.3-1.3-1.8-.6-.6-.7-.8-1.3-2.1-.9-.1-.2-.2-.3-.3-.4l-.1-.1c-.1-.1-.2-.3-.3-.4 0-.1-.1-.1-.1-.2-.2-.3-.5-.5-.9-.7-.7-.4-1.5-.6-2.3-.5-.2 0-.4.1-.6.2-.1 0-.2.1-.2.1-.1 0-.2.1-.3.2-.5.3-1.3.8-2.1 1-.1 0-.1 0-.2.1-.2 0-.4.1-.5.1H66.5h-.1c-.4-.1-1.1-.2-2-.5-.1 0-.2-.1-.3-.1-.9-.2-1.8-.5-2.7-.8-.3-.1-.7-.2-1-.3-.1 0-.1 0-.2-.1h-.1s-.1 0-.1-.1c-.3-.3-.7-.6-1.3-.8-.5-.2-1.2-.4-2.1-.5-.2 0-.5 0-.7.1-.4.2-.8.6-1.2.9.1.1.3.3.4.5.1.2.2.4.3.7l-.6-.6c-.5-.4-1.1-.8-1.7-.9-.8-.2-1.4.4-2.3.9 1 0 1.8.1 2.5.4.1 0 .1 0 .2.1h.1c.1 0 .2.1.3.1.9.4 1.8.6 2.7.6h1.3c.5 0 .8-.1 1.1-.1.1 0 .4 0 .7-.1h2.2c.4.4.9.6 1.6.8z" style=fill:#88ce02 /><path d="M100 51.8c0-19.5-12.5-36.1-30-42.1.1-1.2.2-2.4.3-3.1.1-1.5.2-3.9-.5-4.9-1.6-2.3-9.1-2.1-10.5-.1-.4.6-.7 3.6-.6 5.9-1.1-.1-2.2-.1-3.3-.1-16.5 0-30.9 9-38.6 22.3-2.4 1.4-4.7 2.8-6.1 4C5.4 38 2.2 43.2 1 47c-1.6 4.7-1.1 7.6.4 5.8 1.2-1.5 6.6-5.9 10.1-8.2-.4 2.3-.6 4.8-.6 7.2 0 21 14.5 38.5 34 43.3-.1 1.1.1 2 .7 2.6.9.8 3.2 2 6.4 1.6 2.9-.3 3.5-.5 3.2-2.9h.2c2.7 0 5.3-.2 7.8-.7.1.1.2.2.4.3 1.5 1 7.1.8 9.6.7s6.2.9 8.6.5c2.9-.5 3.4-2.3 1.6-3.2-1.5-.8-3.8-1.3-6.7-3.1C90.6 83.4 100 68.7 100 51.8zM60.1 5.5c0-.5.1-1.5.2-2.1 0-.2 0-.4.1-.5v-.1c.1-.5 1-1.5 4.1-1.5 2.9 0 4.2.9 4.3 1.4v.1c0 .1 0 .3.1.5.1.8.2 1.9.1 2.7 0 .5-.1 2.1-.2 2.9 0 .1 0 .3-.1.5v.1c0 .2-.1.3-.1.5-.1.5-.2 1.1-.4 1.8-.1.6-.5 1.2-.9 1.7-.2.3-.5.5-.7.5-1.1.3-3.1.3-4.2 0-.3-.1-.5-.2-.8-.4 0-.1-.1-.1-.1-.2-.6-.9-.9-1.7-1-2.9 0-.4-.1-.6-.1-.9v-.1c-.1-.6-.2-1-.2-1.6v-.3c-.1-1.3-.1-2.1-.1-2.1zm-.4 7.5v-.4c.6.6 1.3 1.3 1.8 1.7.2.2.5.3.8.3.2 0 .3 0 .5.1h1.6c.8 0 1.6.1 2 0 .1 0 .2 0 .3-.1.6-.3 1.4-1 2.1-1.6 0 .6.1 1.2.1 1.7v1.5c0 .3 0 .5.1.7-.1.1-.2.1-.4.2-.7.4-1.7 1-2.3.9-.5-.1-1.5-.3-2.6-.7-1.2-.3-2.4-.8-3.2-1.2 0 0-.1 0-.1-.1-.2-.3-.4-.5-.6-.7-.3-.4-.5-.6-.5-.7.3-.4.4-.9.4-1.6zm.5 3.4zm-7.3-.3c.6.1 1.2.5 1.7.9.2.2.5.4.6.6-.1-.2-.2-.5-.3-.7-.1-.2-.3-.4-.4-.5.4-.3.8-.7 1.2-.9.2-.1.4-.1.7-.1.9.1 1.6.2 2.1.5.6.2 1 .5 1.3.8 0 0 .1 0 .1.1h.1c.1 0 .1 0 .2.1.3.1.6.2 1 .3.9.3 1.9.6 2.7.8.1 0 .2.1.3.1.9.2 1.6.4 2 .5h.4c.2 0 .4 0 .5-.1.1 0 .1 0 .2-.1.7-.2 1.5-.7 2.1-1 .1-.1.2-.1.3-.2.1 0 .2-.1.2-.1.2-.1.4-.2.6-.2.8-.2 1.7.1 2.3.5.3.2.6.4.9.7 0 .1.1.1.1.2.1.2.2.3.3.4l.1.1c.1.1.2.2.3.4 1.3-.4 1.5.2 2.1.9 1.6-.7 1.7.2 1.8.6h-.1c-.5 0-1.2 0-2.1.2l-.3-.3c-.5-.4-1.2-.8-1.9-1.1-.1 0-.1-.1-.2-.1h-.1c-.4-.2-.8-.2-1.2-.4-.1-.1-.2-.1-.4-.2-.3-.1-.6-.3-.9-.3h-.3c-1.2.1-2 .4-2.7.6-.3.1-.7.2-1 .2-.4.1-.8.1-1.3 0-.3 0-.6-.1-.9-.1-.5-.1-.8-.2-1.2-.3-.2 0-.3-.1-.5-.1h-.1c-.6-.2-1.2-.3-1.8-.4h-.1-2.1c-.4.1-.6.1-.7.1-.3 0-.7.1-1.1.1h-1.3c-.9 0-1.9-.2-2.7-.6-.1 0-.2-.1-.3-.1H53c-.1 0-.1 0-.2-.1-.7-.3-1.6-.4-2.5-.4 1.2-.8 1.8-1.4 2.6-1.3zm6.8 2zm-15.2 4.1c.1-.7.4-1.4.9-2 .1-.1.2-.2.2-.3l.8-.8c.9-.6 1.9-1.1 3-1.3.5-.1 1-.2 1.4-.2H52c.3 0 .6.1.9.1.1 0 .2 0 .2.1.1.1.2.1.4.2.4.2.8.3 1.3.4.2 0 .5.1.7.1.7.1 1.5.1 2.3.1H58.7c.4 0 .7-.1 1-.1H61.7c.6.1 1.1.2 1.7.4.2 0 .4.1.6.2.3.1.7.2 1.1.3.6.1 1.1.2 1.5.2.6 0 1.1-.1 1.6-.2.2 0 .3-.1.5-.1.5-.1 1-.3 1.7-.4.2 0 .5-.1.7-.1h.6c.2 0 .4.1.5.2l.1.1h.1c.1 0 .1 0 .2.1.2.1.3.1.4.1h.2c.1.1.3.1.4.2.4.2 1 .6 1.6.9.1.1.2.2.4.2.1.1.2.1.3.2.2.1.3.3.4.3l.1.1c1.1 1.4 1.8 3.3 1.6 5.3-.3 1.5-1.6.7-2.5.3 0 0-.1 0-.1-.1-.3-.1-.6-.2-.9-.4-.2-.1-.4-.1-.5-.2-1.2-.4-2.5-.7-4-.7-2 0-4.6.1-6.8.8-3 .8-4 .8-5.3.1-.8-.4-1.8-1.1-2.6-1.7-.1-.1-.2-.1-.2-.2-.1-.1-.1-.1-.2-.1-.3-.2-.6-.4-.6-.5l-.1-.1c-.2.3-.6 1-.8 1.4v.1c-.1 1.7-1 4.2-2.6 5.6-.2.1-.4.3-.6.4-.2.1-.5.2-.7.3-.7.2-1.4.2-1.9-.2-.5-.3-1.3-.7-2.3-1.1 2 1.6 3 2.8 3.9 4.9.7 1.7 1.7 4 3.9 6.5l.3.3c1.1 0 2.1.2 3 .7.4.2.7.4 1 .7.2.2.4.3.5.5.5.4.9.8.8 1.3v.1s0 .1-.1.1c-.1.2-.3.5-.5.7-.1.1-.4.4-.6.7-.1.1-.2.2-.3.2-.1.1-.4.3-.7.6-.2.2-.4.3-.5.4-.2.1-.4.4-.6.5-.3.1-.5.2-.8.1-.3 0-.7-.2-1-.3-.5-.3.1-.3-.5-.8-1.4-1-2.2-1.7-1.9-3.4v-.2c-.2-.1-.3-.3-.5-.4-3.9-3-10.1-4.9-11.5-8.3-.9-2.3-1-3.4-.2-4.4.4-.5.8-1 1-1.4 1.3-2.3.9-4.4 2.4-5.4 1.8-1.2 3.3.2 4.1 1.4-.5-2.1-2.3-2.6-2.3-2.8.3.1.3-.1.3-.3zm29 20s-.1 0 0 0c-.1 0-.1 0 0 0-.9.1-3.3.3-5.4.3h-.9c-.7 0-1.3-.1-1.8-.2-.1 0-.2 0-.3-.1-.7-.2-1.6-.5-2.4-.8-.6-.2-1.2-.5-1.7-.7-1.1-.5-2.1-1.1-2.3-1.3-.5-1.4-.7-2.7-.7-3.4.8-.4 1.3-.7 1.9-1.4-1.7.3-2.4.2-3.4-.4-1-.5-2.6-2.2-3.6-3.4 1-1.2 1.7-2.9 1.4-5.1.1-.2.3-.4.4-.6 0 .1.1.1.2.2.7.9 2.4 2 4.6 2.8 1.1.4 2 .1 2.9-.1 4-1 8.1-1.3 11.9-.1.1 0 .2.1.3.1.5.2.9.4 1.4.6.1 0 .1.1.2.1.1.7.2 2-.3 3.5-.1.3-.2.6-.4.9-.2.3-.3.6-.5 1-.1.3-.2.5-.4.8-.2.4-.3.8-.5 1.3-.4 1.4-.7 3.4-.6 6zm-23.9-9c.4-.2 1-.4 1.5-.8 1.6 1.8 3.3 3 5 4.1.3 1.4.5 2.4.8 4.2h-.2c-.1.5-.1.9-.1 1.3-1-.4-2.2-.5-2.6-.5-3.7-4.3-3-6-4.4-8.3zm-32.9 6.5c-1.3.7-2.5 1.4-3.6 2.2-.2.1-.5.3-.7.4-.1.1-.3.2-.5.3-4.5 2.9-8.1 5.8-10.5 8.5 1.7-10.8 10-16.5 14.3-19.2.1-.1.2-.2.4-.2 10-6.2 19.2-9.2 28-11.7-.5.8-.9 1.7-1 2.8v.2c-.8.1-2.5.2-3.5 3-.1.2-.2.5-.3.8-.3 1.2-.6 2-.9 2.6-.9.4-5 2.2-9.9 4.5-1.6.8-3.3 1.6-5 2.4-2.3 1-4.6 2.2-6.8 3.4zm28 24.8s0-.1 0 0c-.4-.3-.8-.5-1.2-.7h-.1c-.4-.2-.7-.3-1.1-.5h-.1c-.4-.1-.8-.3-1.3-.4h-.2c-.4-.1-.8-.2-1.3-.2h-.1c-.5-.1-1-.1-1.5-.1H35.9c-3.7.1-6.5-.4-8.6-1.5-.7-.4-1.4-.8-1.9-1.3-.9-.7-1.5-1.6-2.1-2.6-.4-.7-.7-1.4-.9-2.2-.4-1.2-.6-2.5-.8-3.9 0-.5-.1-1-.2-1.5l-.3-1.5c-.6-2.9-1.6-5.5-3.2-7.2 6.3-3.5 15-7.9 17.8-8.8.3-.1.6-.2.8-.3-.3 1.1.4 2.7.9 3.9 2.1 4.9 8.6 5.4 12.9 9.1 0 .5 0 1.1.2 1.6.5.6 1.7 1.6 1.7 1.6-.2.2-.1.7-.1.7.9 1 2.3 1 2.3 1-1.8 5.2-3.4 10.9-1.9 16.9-.7 1-1.5 1.8-2.2 2.8-.7-.2-1.4-.6-1.9-1.3 0-.1-.1-.1-.1-.2s-.1-.1-.1-.2l-1.5-1.8-.1-.1c-.5-.4-1.2-.9-1.9-1.3zm7.9 33.6c-1.3.1-2.9 0-4.3-.3h-.2-.1c-1.5-.8-2.1-1.2-2-2.4 0-.2 0-.3.1-.5 0-.1.1-.2.1-.3.5-1.1 2.1-2.2 3.4-3.2-.8 0-1.8.7-1.7-.1.2-1.5.9-1.3 1.3-2.1-.2-.3 3.3-.2 3.8.3v.1c0 .7.7 1.7.5 2.2-.1.3-.4-.2-.8-.3.2 1.1.6 3.1 1.3 4.6.1.1.1.2.1.3 0 .1.1.2.1.3 0 .7-.4 1.2-1.6 1.4zM59 67.7c0 .9-.3 1.6-.6 2-.7 1.1-1.7 1.4-2 3.2.4-.6 1.1-1.1 1.1-.9 0 .8-.1 1.4-.1 2v.2c-.1.6-.2 1.1-.3 1.6-.2.9-.5 1.7-.7 2.4-.4 1.2-.9 2.1-1.3 3.1l-.6 1.5c-.6 1.7-.4 5.6-.6 5.7-1.6.3-4.1-.3-4.7-.6.3-2.2.4-4.5.5-6.9.1-2.1.3-4.3.9-6.6.1-.5.3-1 .4-1.5 0-.1 0-.2.1-.2 0-.1 0-.1.1-.2.5-1.6 1.4-2.7 2.6-4.2.4-.4.7-.9 1.2-1.4-.1-.4-.2-.8-.4-1.3-.7-2.6-1.3-7.3 1.5-16.1.1 0 .2-.1.3-.1.2-.1.7-.5.8-.6.1-.1.3-.2.4-.3.1 0 .1-.1.2-.1l.6-.6 1.1-1.1c.4-.4.7-.5.8-.9v-.2c0-.8-1.1-1.5-1.5-2.1l-.1-.1c.1-.2.1-.4.2-.6 0-.2.1-.5.1-.8 0-.2.1-.5.1-.7.1.1.6.4 1.8.7.6.2 1.3.4 2.3.7 1.1.3 2.4.5 3.6.6 2.9.2 5.6 0 6.7-.2h.3v.1c0 .1 0 .2-.1.3v.9c0 .2 0 .3.1.5v.1c0 .4.1.7.2 1.1 0 .3.1.5.1.7v.1c0 .3.1.5.1.7 0 .2.1.3.1.5.1.2.1.4.2.6v.2c.1.4.2.8.2 1.1 1 5.7 2.3 12.9-1.1 16.7.2.8.3 1.9 0 3.2-.1.7-.3 1.4-.6 2.2-.2.5-.3 1-.5 1.5h-.3c-4.5.6-7.1.2-8.3-.1.5-1.6 1.7-3.3 3.7-3.2-.1-3.7-1.1-5-2-7.6 1.3-3 1.3-5.7 2-9.2v-.2c.2-.8.3-1.6.6-2.5-.4.5-.8 1.5-1.2 2.6v.1c-.5 1.5-.9 3.4-1.2 4.8-.2.8-.4 1.6-.7 2.4-.2.5-.4.9-.6 1.4-1.5 1.9-3 3.9-5.5 5.6zm18.5 24.9c1.5 1.1 4.7 1.8 5.5 2.3l.3.3c.1.1.1.2.1.3-.1.4-.7.7-1.9.9-.5.1-.9.1-1.4.1-1.3 0-2.6-.2-5.1-.5-3.4-.5-5.2-.4-8.6-.4-.3 0-.6 0-.9-.1-.2 0-.4-.1-.5-.1-.6-.2-1-.5-1.2-.8-.1-.2-.1-.3-.1-.5-.1-.7.2-1.5.6-2.3.2-.4.3-.7.4-1 .5-1.3.4-2.1.2-4.9 0-.2-.1-.4-.1-.7-.2-1.3-.5-2.3-.8-3.1-.4-1.1-.9-1.9-1.2-3-.6-2.1-1-4.3-.6-4.8H62.5c.2.1.5.2.9.3.5.1 1.1.2 2 .3 2.2.2 5.1-.2 6.6-.4.3-.1.6-.1.8-.1h.4c.4 0 .1.6-.1 1.2-.1.7-.5 3.3-.8 5.1-.3 1.8-.2 7.1-.1 8.8v.1c0 .3 1.9 1.2 3.5 2.1.7.2 1.4.5 1.8.9zm4.8-48.2c0 .1 0 .1 0 0-.1.1-.2.2-.2.3 0-.1-.1-.1-.1-.2 0 .1 0 .2-.1.2-.2.9-.6 2.4-2.2 4.1-.4.4-.7.6-1 .7-.5.1-.9 0-1.5-.1-.9-.2-1.3-.6-2.2-1.1-.1-.6-.3-1.3-.4-1.8 0-.3-.1-.5-.1-.6v-1l.4-.4s.7-1 1.8-1 2.2-.2 2.5-.5v-.1-.3c0-.1 0-.2-.1-.3-.4-1.4-2.1-1.8-1.4-4.8 0-.2.3-.5 1.2-.5-1.4-.3-2-.4-3-1.3.5-1.1 1-1.9 1.3-2.6.8-1.5.3-3.5.3-3.5.8-.3 1.6-.7 1.7-1 .9-2.8-.7-5.5-2.5-7.2 1.2-.1 2.6.1 3.6 1.1 2.4 2.4 1.8 5 1 6.8.6.7 2.1 2.9 1.2 5.3-.2.6-1.4.6-2.3 2.1 2.3-1.3 3.7-1 4.2.7 1 2.4-.6 5.3-2.1 7z"/><path d="M22 53.4v-.2c0-.2-.1-.5-.2-.9s-.1-.8-.2-1.3c-.5-4.7-1.9-9.4-4.9-11.3 3.7-2 16.8-8.5 21.9-10.5 2.9-1.2.8-.4-.2 1.4-.8 1.4-.3 2.9-.5 3.2-.6.8-12.6 10.5-15.9 19.6zm32.2-2.3c-3.4 3.8-12 11-18.2 11.4 8.7-.2 12.2 4.1 14.7 9.7 2.6-5.2 2.7-10.3 2.6-16.1 0-2.6 1.8-6 .9-5zm5.3-23L54.3 24s-1.1 3.1-1 4.6c.1 1.6-1.8 2.7-.9 3.6.9.9 3.2 2.5 4 3.4.7.9 1.1 7.1 1.1 7.1l2.2 2.7s1-1.8 1.1-6.3c.2-5.4-2.9-7.1-3.3-8.6-.4-1.4.6-2.9 2-2.4zm3.1 45.6l3.9.3s1.2-2.2 2.1-3.5c.9-1.4.4-1.6 0-4.6-.4-3-1.4-9.3-1.2-13.6l-3.1 10.2s1.8 5.6 1.6 6.4c-.1.8-3.3 4.8-3.3 4.8zm5 18.8c-1.1 0-2.5-.4-3.5-.8l-1 .3.2 4s5.2.7 4.6-.4c-.6-1.2-.3-3.1-.3-3.1zm12 .6c-1 0-.3.2.4 1.2.8 1 .1 2-.8 2.3l3.2.5 1.9-1.7c.1 0-3.7-2.3-4.7-2.3zM73 76c-1.6.5-4.2.8-5.9.8-1.7.1-3.7-.1-5-.5v1.4s1.2.5 5.4.5c3.5.1 5.7-.8 5.7-.8l.9-.8c-.1.1.5-1.1-1.1-.6zm-.2 3.1c-1.6.6-3.9.6-5.6.7-1.7.1-3.7-.1-5-.5l.1 1.4s.7.3 4.9.4c3.5.1 5.7-.7 5.7-.7l.3-.5c-.1-.1.3-1-.4-.8zm5.9-42.7c-.9-.8-1.4-2.4-1.5-3.3l-1.9 2.5.7 1.2s2.5.1 2.8.1c.4 0 .3-.1-.1-.5zM69 14.7c.6-.7.2-2.7.2-2.7L66 14.6l-4.4-.8-.5-1.3-1.3-.1c.8 1.8 1.8 2.5 3.3 3.1.9.4 4.5.9 5.9-.8z" style=opacity:.4;fill-rule:evenodd;clip-rule:evenodd /></svg></a></div></div>';

  if (element) {
    root.style.position = "absolute";
    root.style.top = minimal ? "calc(100% - 42px)" : "calc(100% - 51px)";
  }

  if (css) {
    if (_isString(css)) {
      root.style.cssText = css;
    } else if (_isObject(css)) {
      css.data = "root";
      gsap.set(root, css).kill();
    }

    if (root.style.top) {
      root.style.bottom = "auto";
    }

    if (root.style.width) {
      gsap.set(root, {
        xPercent: -50,
        left: "50%",
        right: "auto",
        data: "root"
      }).kill();
    }
  }

  if (!minimal && root.offsetWidth < 600) {
    root.setAttribute("class", "gs-dev-tools minimal");

    if (element) {
      root.style.top = "calc(100% - 42px)";
    }
  }

  return root;
},
    _clickedOnce = true,
    //perhaps we shouldn't preventDefault() on the first mousedown/touchstart/pointerdown so that iframes get focus properly. Did that previously, but now it seems to prevent interaction on the first click (annoying).
_addListener = function _addListener(e, type, callback, capture) {
  var handler, altType;

  if (type === "mousedown" || type === "mouseup") {
    e.style.cursor = "pointer";
  }

  if (type === "mousedown") {
    //some browsers call BOTH mousedown AND touchstart, for example, on a single interaction so we need to skip one of them if both are called within 100ms.
    altType = !_isUndefined(e.onpointerdown) ? "pointerdown" : !_isUndefined(e.ontouchstart) ? "touchstart" : null;

    if (altType) {
      handler = function handler(event) {
        if (event.target.nodeName.toLowerCase() !== "select" && event.type === altType) {
          //don't preventDefault() on a <select> or else it won't open!
          event.stopPropagation();

          if (_clickedOnce) {
            //otherwise, both touchstart and mousedown will get called.
            event.preventDefault();
            callback.call(e, event);
          }
        } else if (event.type !== altType) {
          callback.call(e, event);
        }

        _clickedOnce = true;
      };

      e.addEventListener(altType, handler, capture);

      if (altType !== "pointerdown") {
        e.addEventListener(type, handler, capture);
      }

      return;
    }
  }

  e.addEventListener(type, callback, capture);
},
    _removeListener = function _removeListener(e, type, callback) {
  e.removeEventListener(type, callback);
  type = type !== "mousedown" ? null : !_isUndefined(e.onpointerdown) ? "pointerdown" : !_isUndefined(e.ontouchstart) ? "touchstart" : null;

  if (type) {
    e.removeEventListener(type, callback);
  }
},
    _selectValue = function _selectValue(element, value, label, insertIfAbsent) {
  var options = element.options,
      i = options.length,
      option;
  value += "";

  while (--i > -1) {
    if (options[i].innerHTML === value || options[i].value === value) {
      element.selectedIndex = i;
      label.innerHTML = options[i].innerHTML;
      return options[i];
    }
  }

  if (insertIfAbsent) {
    option = _createElement("option", element);
    option.setAttribute("value", value);
    option.innerHTML = label.innerHTML = _isString(insertIfAbsent) ? insertIfAbsent : value;
    element.selectedIndex = options.length - 1;
  }
},
    //increments the selected value of a <select> up or down by a certain amount.
_shiftSelectedValue = function _shiftSelectedValue(element, amount, label) {
  var options = element.options,
      i = Math.min(options.length - 1, Math.max(0, element.selectedIndex + amount));
  element.selectedIndex = i;

  if (label) {
    label.innerHTML = options[i].innerHTML;
  }

  return options[i].value;
},
    //moves everything from _globalTimeline into _recordedRoot and updates the _rootTween if it is currently controlling the Global timeline (_recordedRoot). _recordedTemp is just a temporary recording area for anything that happens while _recordedRoot is paused. Returns true if the _recordedRoot's duration changed due to the merge.
_merge = function _merge() {
  var t = _globalTimeline._first,
      duration,
      next,
      target;

  if (_rootInstance) {
    duration = _recordedRoot._dur;

    while (t) {
      next = t._next;
      target = t._targets && t._targets[0];

      if (!(_isFunction(target) && target === t.vars.onComplete && !t._dur) && !(target && target._gsIgnore)) {
        //typically, delayedCalls aren't included in the _recordedTemp, but since the hijacked add() below fires BEFORE TweenLite's constructor sets the target, we couldn't check that target === vars.onComplete there. And Draggable creates a tween with just an onComplete (no onReverseComplete), thus it fails that test. Therefore, we test again here to avoid merging that in.
        _recordedRoot.add(t, t._start - t._delay);
      }

      t = next;
    }

    return duration !== _recordedRoot.duration();
  }
},
    _updateRootDuration = function _updateRootDuration() {
  if (_rootInstance) {
    _rootInstance.update();

    _rootIsDirty = false;
  }

  gsap.ticker.remove(_updateRootDuration);
},
    _buildPlayPauseMorph = function _buildPlayPauseMorph(svg) {
  var tl = gsap.timeline({
    data: "root",
    parent: _independentRoot,
    onComplete: function onComplete() {
      return tl.kill();
    }
  }, _independentRoot._time);
  tl.to(svg.querySelector(".play-1"), {
    duration: 0.4,
    attr: {
      d: "M5.75,3.13 C5.75,9.79 5.75,16.46 5.75,23.13 4.08,23.13 2.41,23.13 0.75,23.13 0.75,16.46 0.75,9.79 0.75,3.12 2.41,3.12 4.08,3.12 5.75,3.12"
    },
    ease: "power2.inOut",
    rotation: 360,
    transformOrigin: "50% 50%"
  }).to(svg.querySelector(".play-2"), {
    duration: 0.4,
    attr: {
      d: "M16.38,3.13 C16.38,9.79 16.38,16.46 16.38,23.13 14.71,23.13 13.04,23.13 11.38,23.13 11.38,16.46 11.38,9.79 11.38,3.12 13.04,3.12 14.71,3.12 16.38,3.12"
    },
    ease: "power2.inOut",
    rotation: 360,
    transformOrigin: "50% 50%"
  }, 0.05);
  return tl;
},
    _buildLoopAnimation = function _buildLoopAnimation(svg) {
  var tl = gsap.timeline({
    data: "root",
    id: "loop",
    parent: _independentRoot,
    paused: true,
    onComplete: function onComplete() {
      return tl.kill();
    }
  }, _independentRoot._time);
  tl.to(svg, {
    duration: 0.5,
    rotation: 360,
    ease: "power3.inOut",
    transformOrigin: "50% 50%"
  }).to(svg.querySelectorAll(".loop-path"), {
    duration: 0.5,
    fill: "#91e600",
    ease: "none"
  }, 0);
  return tl;
},
    _getAnimationById = function _getAnimationById(id) {
  return gsap.getById(id) || _independentRoot.getById(id) || id === _recordedRoot.vars.id && _recordedRoot;
},
    _initCore = function _initCore(core) {
  gsap = core || _getGSAP();

  if (!_coreInitted) {
    if (gsap && _windowExists()) {
      _doc = document;
      _docEl = _doc.documentElement;
      _win = window;

      _context = gsap.core.context || function () {};

      gsap.registerPlugin(Draggable);
      _globalTimeline = gsap.globalTimeline;
      _globalTimeline._sort = true;
      _globalTimeline.autoRemoveChildren = false;
      Animation = gsap.core.Animation;
      _independentRoot = gsap.timeline({
        data: "indy",
        autoRemoveChildren: true,
        smoothChildTiming: true
      });

      _independentRoot.kill();

      _independentRoot._dp = 0; //don't let it revert to the global timeline as its parent.

      _independentRoot.to({}, {
        duration: 1e12
      });

      _recordedRoot = gsap.timeline({
        data: "root",
        id: "Global Timeline",
        autoRemoveChildren: false,
        smoothChildTiming: true,
        parent: _independentRoot
      }, 0);
      _rootTween = gsap.to(_recordedRoot, {
        duration: 1,
        time: 1,
        ease: "none",
        data: "root",
        id: "_rootTween",
        paused: true,
        immediateRender: false,
        parent: _independentRoot
      }, 0); // so that auto-overwriting works. Initially we transferred the tweens to the _recordedRoot.

      _globalTimeline.killTweensOf = function (targets, props, onlyActive) {
        _recordedRoot.killTweensOf(targets, props, onlyActive);

        _recordedRoot.killTweensOf.call(_globalTimeline, targets, props, onlyActive);
      };

      _independentRoot._start = gsap.ticker.time;
      gsap.ticker.add(function (time) {
        return _independentRoot.render(time - _independentRoot._start);
      }); // before 3.7.0, the listener below was necessary (in place of the line above)
      // gsap.ticker.add(time => {
      // 	_independentRoot._initted || _independentRoot.render(0.001, true); // to prevent callbacks from being fired on the first tick, like onComplete would fire immediately and then again at the correct time.
      // 	_independentRoot.render(time - _independentRoot._start);
      // });
      //align the all of the playheads so they're starting at 0 now.

      _globalTimeline._start += _globalTimeline._time;
      _recordedRoot._start = _globalTimeline._time = _globalTimeline._tTime = 0;

      _delayedCall = function _delayedCall(delay, callback, params, scope) {
        return gsap.to(callback, {
          delay: delay,
          duration: 0,
          onComplete: callback,
          onReverseComplete: callback,
          onCompleteParams: params,
          onReverseCompleteParams: params,
          callbackScope: scope,
          parent: _independentRoot
        }, _independentRoot._time);
      }; //in case GSDevTools.create() is called before anything is actually on the global timeline, we've gotta update it or else the duration will be 0 and it'll be stuck.


      _delayedCall(0.01, function () {
        return _rootInstance ? _rootInstance.update() : _merge();
      }); //initially we record everything into the _recordedRoot Timeline because developers might call GSDevTools.create() AFTER some of their code executes, but after 2 seconds if there aren't any GSDevTool instances that have globalSync enabled, we should dump all the stuff from _recordedRoot into the global timeline to improve performance and avoid issues where _recordedRoot is paused and reaches its end and wants to stop the playhead.


      _delayedCall(2, function () {
        var t, next, offset;

        if (!_rootInstance) {
          _merge();

          t = _recordedRoot._first;
          offset = _recordedRoot._start;

          while (t) {
            next = t._next; //any animations that aren't finished should be dumped into the root timeline. If they're done, just kill them.

            if (t._tDur !== t._tTime || !t._dur && t.progress() !== 1) {
              _globalTimeline.add(t, t._start - t._delay + offset);
            } else {
              t.kill();
            }

            t = next;
          }
        }

        if (GSDevTools.globalRecordingTime > 2) {
          _delayedCall(GSDevTools.globalRecordingTime - 2, function () {
            _rootInstance && _rootInstance.update();
            _recording = false;
            _globalTimeline.autoRemoveChildren = true;
          });
        } else {
          _recording = false;
          _globalTimeline.autoRemoveChildren = true;
        }

        _startupPhase = false;
      });

      _coreInitted = 1;
    }
  }
},
    _checkIndependence = function _checkIndependence(animation, vars) {
  if (!vars.globalSync && animation.parent !== _globalTimeline) {
    //in case it's nested in a timeline (playing it won't help if the parent timeline isn't playing).
    _globalTimeline.add(animation, _globalTimeline.time());
  }
},
    GSDevTools = function GSDevTools(vars) {
  if (!_coreInitted) {
    _initCore();

    gsap || console.warn("Please gsap.registerPlugin(GSDevTools)");
  }

  this.vars = vars = vars || {};

  if (vars.animation) {
    (GSDevTools.getByAnimation(vars.animation) || {
      kill: function kill() {
        return 0;
      }
    }).kill();
  }

  vars.id = vars.id || (_isString(vars.animation) ? vars.animation : _idSeed++); //try to find a unique ID so that sessionStorage can be mapped to it (otherwise, for example, all the embedded codepens on a page would share the same settings). So if no id is defined, see if there's a string-based "animation" defined. Last of all, we default to a numeric counter that we increment.

  _lookup[vars.id + ""] = this;
  "globalSync" in vars || (vars.globalSync = !vars.animation); //if the user calls create() and passes in an animation AFTER the initial recording time has elapsed, there's a good chance the animation won't be in the recordedRoot, so we change the default globalSync to false because that's the most intuitive behavior.
  //GENERAL/UTILITY

  var _self = this,
      root = _createRootElement(vars.container, vars.minimal, vars.css),
      find = function find(s) {
    return root.querySelector(s);
  },
      record = function record(key, value) {
    if (vars.persist !== false && _supportsStorage) {
      sessionStorage.setItem("gs-dev-" + key + vars.id, value);
    }

    return value;
  },
      recall = function recall(key) {
    var value;

    if (vars.persist !== false && _supportsStorage) {
      value = sessionStorage.getItem("gs-dev-" + key + vars.id);
      return key === "animation" ? value : key === "loop" ? value === "true" : parseFloat(value); // handle data typing too.
    }
  },
      //SCRUBBER/PROGRESS
  playhead = find(".playhead"),
      timelineTrack = find(".timeline-track"),
      progressBar = find(".progress-bar"),
      timeLabel = find(".time"),
      durationLabel = find(".duration"),
      pixelToTimeRatio,
      timeAtDragStart,
      dragged,
      skipDragUpdates,
      progress = 0,
      inPoint = find(".in-point"),
      outPoint = find(".out-point"),
      inProgress = 0,
      outProgress = 100,
      pausedWhenDragStarted,
      list = find(".animation-list"),
      animationLabel = find(".animation-label"),
      selectedAnimation,
      //the currently selected animation
  linkedAnimation,
      //the animation that's linked to all the controls and scrubber. This is always _rootTween if globalSync is true, so it can be different than the selectedAnimation!
  declaredAnimation,
      //whatever the user defines in the config object initially (often this will be null). If the user defines a string, it'll be resolved to a real Animation instance for this variable.
  startTime,
      endTime,
      _fullyInitialized,
      //we call initialize() initially, and then again on the very next tick just in case someone called GSDevTools.create() BEFORE they create their animations. This variable tracks that state. Note: we don't record sessionStorage.setItem() until we're fully initialized, otherwise we may inadvertently set in/out points to the defaults just because the animation couldn't be found (yet).
  keyboardHandler,
      playPauseButton = find(".play-pause"),
      playPauseMorph = _buildPlayPauseMorph(playPauseButton),
      paused = false,
      loopButton = find(".loop"),
      loopAnimation = _buildLoopAnimation(loopButton),
      loopEnabled,
      timeScale = find(".time-scale select"),
      timeScaleLabel = find(".time-scale-label"),
      //spits back a common onPress function for anything that's dragged along the timeline (playhead, inPoint, outPoint). The originRatio is a value from 0-1 indicating how far along the x-axis the origin is located (0.5 is in the center, 0 is left, 1 is on right side). limitElement is optional, and sets the bounds such that the element can't be dragged past the limitElement.
  onPressTimeline = function onPressTimeline(element, originRatio, limitToInOut) {
    return function (e) {
      var trackBounds = timelineTrack.getBoundingClientRect(),
          elementBounds = element.getBoundingClientRect(),
          left = elementBounds.width * originRatio,
          x = gsap.getProperty(element, "x"),
          minX = trackBounds.left - elementBounds.left - left + x,
          maxX = trackBounds.right - elementBounds.right + (elementBounds.width - left) + x,
          unlimitedMinX = minX,
          limitBounds;

      if (limitToInOut) {
        if (element !== inPoint) {
          limitBounds = inPoint.getBoundingClientRect();

          if (limitBounds.left) {
            //if inPoint is hidden (like display:none), ignore.
            minX += limitBounds.left + limitBounds.width - trackBounds.left;
          }
        }

        if (element !== outPoint) {
          limitBounds = outPoint.getBoundingClientRect();

          if (limitBounds.left) {
            //if outPoint is hidden (like display:none), ignore.
            maxX -= trackBounds.left + trackBounds.width - limitBounds.left;
          }
        }
      }

      pausedWhenDragStarted = paused;
      this.applyBounds({
        minX: minX,
        maxX: maxX
      });
      pixelToTimeRatio = linkedAnimation.duration() / trackBounds.width;
      timeAtDragStart = -unlimitedMinX * pixelToTimeRatio;

      if (!skipDragUpdates) {
        linkedAnimation.pause(timeAtDragStart + pixelToTimeRatio * this.x);
      } else {
        linkedAnimation.pause();
      }

      if (this.target === playhead) {
        if (this.activated) {
          this.allowEventDefault = false;
        }

        this.activated = true;
      }

      dragged = true;
    };
  },
      progressDrag = Draggable.create(playhead, {
    type: "x",
    cursor: "ew-resize",
    allowNativeTouchScrolling: false,
    allowEventDefault: true,
    //otherwise, when dragged outside an iframe, the mouseup doesn't bubble up so it could seem "stuck" to the mouse.
    onPress: onPressTimeline(playhead, 0.5, true),
    onDrag: function onDrag() {
      var time = timeAtDragStart + pixelToTimeRatio * this.x;

      if (time < 0) {
        time = 0;
      } else if (time > linkedAnimation._dur) {
        time = linkedAnimation._dur;
      }

      if (!skipDragUpdates) {
        linkedAnimation.time(time);
      }

      progressBar.style.width = Math.min(outProgress - inProgress, Math.max(0, time / linkedAnimation._dur * 100 - inProgress)) + "%";
      timeLabel.innerHTML = time.toFixed(2);
    },
    onRelease: function onRelease() {
      paused || linkedAnimation.resume();
    }
  })[0],
      resetInOut = function resetInOut() {
    inProgress = 0;
    outProgress = 100;
    inPoint.style.left = "0%";
    outPoint.style.left = "100%";
    record("in", inProgress);
    record("out", outProgress);
    updateProgress(true);
  },
      inDrag = Draggable.create(inPoint, {
    type: "x",
    cursor: "ew-resize",
    zIndexBoost: false,
    allowNativeTouchScrolling: false,
    allowEventDefault: true,
    //otherwise, when dragged outside an iframe, the mouseup doesn't bubble up so it could seem "stuck" to the mouse.
    onPress: onPressTimeline(inPoint, 1, true),
    onDoubleClick: resetInOut,
    onDrag: function onDrag() {
      inProgress = (timeAtDragStart + pixelToTimeRatio * this.x) / linkedAnimation.duration() * 100;
      linkedAnimation.progress(inProgress / 100);
      updateProgress(true);
    },
    onRelease: function onRelease() {
      if (inProgress < 0) {
        inProgress = 0;
      }

      _clearSelection(); //for responsiveness, convert the px-based transform into %-based left position.


      inPoint.style.left = inProgress + "%";
      record("in", inProgress);
      gsap.set(inPoint, {
        x: 0,
        data: "root",
        display: "block"
      }); //set display:block so that it remains visible even when the minimal skin is enabled.

      if (!paused) {
        linkedAnimation.resume();
      }
    }
  })[0],
      outDrag = Draggable.create(outPoint, {
    type: "x",
    cursor: "ew-resize",
    allowNativeTouchScrolling: false,
    allowEventDefault: true,
    //otherwise, when dragged outside an iframe, the mouseup doesn't bubble up so it could seem "stuck" to the mouse.
    zIndexBoost: false,
    onPress: onPressTimeline(outPoint, 0, true),
    onDoubleClick: resetInOut,
    onDrag: function onDrag() {
      outProgress = (timeAtDragStart + pixelToTimeRatio * this.x) / linkedAnimation.duration() * 100;
      linkedAnimation.progress(outProgress / 100);
      updateProgress(true);
    },
    onRelease: function onRelease() {
      if (outProgress > 100) {
        outProgress = 100;
      }

      _clearSelection(); //for responsiveness, convert the px-based transform into %-based left position.


      outPoint.style.left = outProgress + "%";
      record("out", outProgress);
      gsap.set(outPoint, {
        x: 0,
        data: "root",
        display: "block"
      }); //set display:block so that it remains visible even when the minimal skin is enabled.

      if (!pausedWhenDragStarted) {
        play();
        linkedAnimation.resume();
      }
    }
  })[0],
      updateProgress = function updateProgress(force) {
    // NOTE: "force" is actually the "time" when this method gets called by the gsap.ticker!
    if (progressDrag.isPressed && force !== true) {
      return;
    }

    var p = !loopEnabled && selectedAnimation._repeat === -1 ? selectedAnimation.totalTime() / selectedAnimation.duration() * 100 : linkedAnimation.progress() * 100 || 0,
        repeatDelayPhase = selectedAnimation._repeat && selectedAnimation._rDelay && selectedAnimation.totalTime() % (selectedAnimation.duration() + selectedAnimation._rDelay) > selectedAnimation.duration(),
        target;

    if (p > 100) {
      p = 100;
    }

    if (p >= outProgress) {
      if (loopEnabled && !linkedAnimation.paused() && !progressDrag.isDragging) {
        if (!repeatDelayPhase) {
          p = inProgress;
          target = linkedAnimation._targets && linkedAnimation._targets[0];

          if (target === selectedAnimation) {
            //in case there are callbacks on the timeline, when we jump back to the start we should seek() so that the playhead doesn't drag [backward] past those and trigger them.
            target.seek(startTime + (endTime - startTime) * inProgress / 100);
          }

          if (selectedAnimation._repeat > 0 && !inProgress && outProgress === 100) {
            if (selectedAnimation.totalProgress() === 1) {
              linkedAnimation.totalProgress(0, true).resume();
            }
          } else {
            linkedAnimation.progress(p / 100, true).resume();
          }
        }
      } else {
        if (p !== outProgress || selectedAnimation._repeat === -1) {
          p = outProgress;
          linkedAnimation.progress(p / 100);
        }

        if (!paused && (outProgress < 100 || selectedAnimation.totalProgress() === 1 || selectedAnimation._repeat === -1)) {
          pause();
        }
      }
    } else if (p < inProgress) {
      p = inProgress;
      linkedAnimation.progress(p / 100, true);
    }

    if (p !== progress || force === true) {
      progressBar.style.left = inProgress + "%";
      progressBar.style.width = Math.max(0, p - inProgress) + "%";
      playhead.style.left = p + "%";
      timeLabel.innerHTML = linkedAnimation._time.toFixed(2);
      durationLabel.innerHTML = linkedAnimation._dur.toFixed(2);

      if (dragged) {
        playhead.style.transform = "translate(-50%,0)";
        playhead._gsap.x = "0px";
        playhead._gsap.xPercent = -50;
        dragged = false;
      }

      progress = p;
    }

    linkedAnimation.paused() !== paused && togglePlayPause(); // if the user has an addPause() in the middle of the animation.
  },
      onPressSeekBar = function onPressSeekBar(e) {
    if (progressDrag.isPressed) {
      return;
    }

    var bounds = e.target.getBoundingClientRect(),
        x = (e.changedTouches ? e.changedTouches[0] : e).clientX,
        p = (x - bounds.left) / bounds.width * 100;

    if (p < inProgress) {
      inProgress = p = Math.max(0, p);
      inPoint.style.left = inProgress + "%";
      inDrag.startDrag(e);
      return;
    } else if (p > outProgress) {
      outProgress = p = Math.min(100, p);
      outPoint.style.left = outProgress + "%";
      outDrag.startDrag(e);
      return;
    }

    linkedAnimation.progress(p / 100).pause();
    updateProgress(true);
    progressDrag.startDrag(e);
  },
      //PLAY/PAUSE button
  play = function play() {
    if (linkedAnimation.progress() >= outProgress / 100) {
      _checkIndependence(linkedAnimation, vars);

      var target = linkedAnimation._targets && linkedAnimation._targets[0];

      if (target === selectedAnimation) {
        //in case there are callbacks on the timeline, when we jump back to the start we should seek() so that the playhead doesn't drag [backward] past those and trigger them.
        target.seek(startTime + (endTime - startTime) * inProgress / 100);
      }

      if (linkedAnimation._repeat && !inProgress) {
        linkedAnimation.totalProgress(0, true); //for repeating animations, don't get stuck in the last iteration - jump all the way back to the start.
      } else if (!linkedAnimation.reversed()) {
        linkedAnimation.progress(inProgress / 100, true);
      }
    }

    playPauseMorph.play();
    linkedAnimation.resume();

    if (paused) {
      _self.update();
    }

    paused = false;
  },
      pause = function pause() {
    playPauseMorph.reverse();

    if (linkedAnimation) {
      linkedAnimation.pause();
    }

    paused = true;
  },
      togglePlayPause = function togglePlayPause() {
    if (paused) {
      play();
    } else {
      pause();
    }
  },
      //REWIND button
  onPressRewind = function onPressRewind(e) {
    if (progressDrag.isPressed) {
      return;
    } //_self.update();


    _checkIndependence(linkedAnimation, vars);

    var target = linkedAnimation._targets && linkedAnimation._targets[0];

    if (target === selectedAnimation) {
      //in case there are callbacks on the timeline, when we jump back to the start we should seek() so that the playhead doesn't drag [backward] past those and trigger them.
      target.seek(startTime + (endTime - startTime) * inProgress / 100);
    }

    linkedAnimation.progress(inProgress / 100, true);

    if (!paused) {
      linkedAnimation.resume();
    }
  },
      //LOOP button
  loop = function loop(value) {
    loopEnabled = value;
    record("loop", loopEnabled);

    if (loopEnabled) {
      loopAnimation.play();

      if (linkedAnimation.progress() >= outProgress / 100) {
        var target = linkedAnimation._targets && linkedAnimation._targets[0];

        if (target === selectedAnimation) {
          //in case there are callbacks on the timeline, when we jump back to the start we should seek() so that the playhead doesn't drag [backward] past those and trigger them.
          target.seek(startTime + (endTime - startTime) * inProgress / 100);
        }

        if (selectedAnimation._repeat && !inProgress && outProgress === 100) {
          linkedAnimation.totalProgress(0, true);
        } else {
          linkedAnimation.progress(inProgress / 100, true);
        }

        play();
      }
    } else {
      loopAnimation.reverse();
    }
  },
      toggleLoop = function toggleLoop() {
    return loop(!loopEnabled);
  },
      //ANIMATIONS list
  updateList = function updateList() {
    var animations = _getChildrenOf(declaredAnimation && !vars.globalSync ? declaredAnimation : _recordedRoot, true),
        options = list.children,
        matches = 0,
        option,
        i;

    if (declaredAnimation && !vars.globalSync) {
      animations.unshift(declaredAnimation);
    } else if (!vars.hideGlobalTimeline) {
      animations.unshift(_recordedRoot);
    }

    for (i = 0; i < animations.length; i++) {
      option = options[i] || _createElement("option", list);
      option.animation = animations[i];
      matches = i && animations[i].vars.id === animations[i - 1].vars.id ? matches + 1 : 0;
      option.setAttribute("value", option.innerHTML = animations[i].vars.id + (matches ? " [" + matches + "]" : animations[i + 1] && animations[i + 1].vars.id === animations[i].vars.id ? " [0]" : ""));
    }

    for (; i < options.length; i++) {
      list.removeChild(options[i]);
    }
  },
      animation = function animation(anim) {
    var ts = parseFloat(timeScale.options[timeScale.selectedIndex].value) || 1,
        tl,
        maxDuration;

    if (!arguments.length) {
      return selectedAnimation;
    }

    if (_isString(anim)) {
      anim = _getAnimationById(anim);
    } //console.log("animation() ", anim.vars.id);


    if (!(anim instanceof Animation)) {
      console.warn("GSDevTools error: invalid animation.");
    }

    if (anim.scrollTrigger) {
      console.warn("GSDevTools can't work with ScrollTrigger-based animations; either the scrollbar -OR- the GSDevTools scrubber can control the animation.");
    }

    if (anim === selectedAnimation) {
      return;
    }

    if (selectedAnimation) {
      selectedAnimation._inProgress = inProgress;
      selectedAnimation._outProgress = outProgress;
    }

    selectedAnimation = anim;

    if (linkedAnimation) {
      ts = linkedAnimation.timeScale();

      if (linkedAnimation._targets && linkedAnimation._targets[0] === declaredAnimation) {
        declaredAnimation.resume();
        linkedAnimation.kill();
      }
    }

    inProgress = selectedAnimation._inProgress || 0;
    outProgress = selectedAnimation._outProgress || 100;
    inPoint.style.left = inProgress + "%";
    outPoint.style.left = outProgress + "%";

    if (_fullyInitialized) {
      //don't record inProgress/outProgress unless we're fully instantiated because people may call GSDevTools.create() before creating/defining their animations, thus the inTime/outTime may not exist yet.
      record("animation", selectedAnimation.vars.id);
      record("in", inProgress);
      record("out", outProgress);
    }

    startTime = 0;
    maxDuration = vars.maxDuration || Math.min(1000, _getClippedDuration(selectedAnimation));

    if (selectedAnimation === _recordedRoot || vars.globalSync) {
      _merge();

      linkedAnimation = _rootTween;
      _rootInstance && _rootInstance !== _self && console.warn("Error: GSDevTools can only have one instance that's globally synchronized.");
      _rootInstance = _self;

      if (selectedAnimation !== _recordedRoot) {
        tl = selectedAnimation;
        endTime = tl.totalDuration();

        if (endTime > 99999999) {
          //in the case of an infinitely repeating animation, just use a single iteration's duration instead.
          endTime = tl.duration();
        }

        while (tl.parent) {
          startTime = startTime / tl._ts + tl._start;
          endTime = endTime / tl._ts + tl._start;
          tl = tl.parent;
        }
      } else {
        endTime = _recordedRoot.duration();
      }

      if (endTime - startTime > maxDuration) {
        //cap end time at 1000 because it doesn't seem reasonable to accommodate super long stuff.
        endTime = startTime + maxDuration;
      }

      _recordedRoot.pause(startTime);

      _rootTween.vars.time = endTime;

      _rootTween.invalidate();

      _rootTween.duration(endTime - startTime).timeScale(ts); //wait for a tick before starting because some browsers freeze things immediately following a <select> selection, like on MacOS it flashes a few times before disappearing, so this prevents a "jump".


      if (paused) {
        //jump forward and then back in order to make sure the start/end values are recorded internally right away and don't drift outside this tween.
        _rootTween.progress(1, true).pause(0, true);
      } else {
        _delayedCall(0.01, function () {
          _rootTween.resume().progress(inProgress / 100);

          paused && play();
        });
      }
    } else {
      if (_rootInstance === _self) {
        _rootInstance = null;
      }

      startTime = Math.min(inProgress * selectedAnimation.duration(), selectedAnimation.time());

      if (selectedAnimation === declaredAnimation || !declaredAnimation) {
        linkedAnimation = selectedAnimation;

        if (!loopEnabled && linkedAnimation._repeat) {
          loop(true);
        }
      } else {
        //if an animation is declared in the config object, and the user chooses a sub-animation (nested), we tween the playhead of the declaredAnimation to keep everything synchronized even though globalSync isn't true.
        tl = selectedAnimation;
        endTime = tl.totalDuration();

        if (endTime > 99999999) {
          //in the case of an infinitely repeating animation, just use a single iteration's duration instead.
          endTime = tl.duration();
        }

        while (tl.parent.parent && tl !== declaredAnimation) {
          startTime = startTime / (tl._ts || tl._pauseTS) + tl._start;
          endTime = endTime / (tl._ts || tl._pauseTS) + tl._start;
          tl = tl.parent;
        }

        if (endTime - startTime > maxDuration) {
          //cap end time at 1000 because it doesn't seem reasonable to accommodate super long stuff.
          endTime = startTime + maxDuration;
        }

        declaredAnimation.pause(startTime);
        linkedAnimation = gsap.to(declaredAnimation, {
          duration: endTime - startTime,
          time: endTime,
          ease: "none",
          data: "root",
          parent: _independentRoot
        }, _independentRoot._time);
      }

      linkedAnimation.timeScale(ts);

      _rootTween.pause();

      _recordedRoot.resume();

      linkedAnimation.seek(0);
    }

    durationLabel.innerHTML = linkedAnimation.duration().toFixed(2);

    _selectValue(list, selectedAnimation.vars.id, animationLabel);
  },
      updateRootDuration = function updateRootDuration() {
    var time, ratio, duration;

    if (selectedAnimation === _recordedRoot) {
      time = _recordedRoot._time;

      _recordedRoot.progress(1, true).time(time, true); //jump to the end and back again because sometimes a tween that hasn't rendered yet will affect duration, like a TimelineMax.tweenTo() where the duration gets set in the onStart.


      time = (_rootTween._dp._time - _rootTween._start) * _rootTween._ts;
      duration = Math.min(1000, _recordedRoot.duration());

      if (duration === 1000) {
        duration = Math.min(1000, _getClippedDuration(_recordedRoot));
      }

      ratio = _rootTween.duration() / duration;

      if (ratio !== 1 && duration) {
        inProgress *= ratio;

        if (outProgress < 100) {
          outProgress *= ratio;
        }

        _rootTween.seek(0);

        _rootTween.vars.time = duration;

        _rootTween.invalidate();

        _rootTween.duration(duration);

        _rootTween.time(time);

        durationLabel.innerHTML = duration.toFixed(2);
        inPoint.style.left = inProgress + "%";
        outPoint.style.left = outProgress + "%";
        updateProgress(true);
      }
    }
  },
      onChangeAnimation = function onChangeAnimation(e) {
    animation(list.options[list.selectedIndex].animation);

    if (e.target && e.target.blur) {
      //so that if an option is selected, and then the user tries to hit the up/down arrow, it doesn't just try selecting something else in the <select>.
      e.target.blur();
    }

    paused && play();
  },
      //TIMESCALE button
  onChangeTimeScale = function onChangeTimeScale(e) {
    var ts = parseFloat(timeScale.options[timeScale.selectedIndex].value) || 1,
        target;
    linkedAnimation.timeScale(ts);
    record("timeScale", ts);

    if (!paused) {
      if (linkedAnimation.progress() >= outProgress / 100) {
        target = linkedAnimation._targets && linkedAnimation._targets[0];

        if (target === selectedAnimation) {
          //in case there are callbacks on the timeline, when we jump back to the start we should seek() so that the playhead doesn't drag [backward] past those and trigger them.
          target.seek(startTime + (endTime - startTime) * inProgress / 100);
        }

        linkedAnimation.progress(inProgress / 100, true).pause();
      } else {
        linkedAnimation.pause();
      }

      _delayedCall(0.01, function () {
        return linkedAnimation.resume();
      });
    }

    timeScaleLabel.innerHTML = ts + "x";

    if (timeScale.blur) {
      //so that if an option is selected, and then the user tries to hit the up/down arrow, it doesn't just try selecting something else in the <select>.
      timeScale.blur();
    }
  },
      //AUTOHIDE
  autoHideTween = gsap.to([find(".gs-bottom"), find(".gs-top")], {
    duration: 0.3,
    autoAlpha: 0,
    y: 50,
    ease: "power2.in",
    data: "root",
    paused: true,
    parent: _independentRoot
  }, _independentRoot._time),
      hidden = false,
      onMouseOut = function onMouseOut(e) {
    if (!Draggable.hitTest(e, root) && !progressDrag.isDragging && !inDrag.isDragging && !outDrag.isDragging) {
      autoHideDelayedCall.restart(true);
    }
  },
      hide = function hide() {
    if (!hidden) {
      autoHideTween.play();
      autoHideDelayedCall.pause();
      hidden = true;
    }
  },
      show = function show() {
    autoHideDelayedCall.pause();

    if (hidden) {
      autoHideTween.reverse();
      hidden = false;
    }
  },
      toggleHide = function toggleHide() {
    if (hidden) {
      show();
    } else {
      hide();
    }
  },
      autoHideDelayedCall = _delayedCall(1.3, hide).pause(),
      initialize = function initialize(preliminary) {
    //if on startup, someone does a timeline.seek(), we must honor it, so when initialize() is called, we record _recordedRoot._start so that we can use that as an offset. Remember, however, that we call initialize() twice on startup, once after a tick has elapsed just in case someone called GSDevTools.create() before their animation code, so we must record the value (once).
    if (_startupPhase && !_globalStartTime) {
      _globalStartTime = _recordedRoot._start;
    }

    _fullyInitialized = !preliminary;
    declaredAnimation = _parseAnimation(vars.animation);

    if (declaredAnimation && !declaredAnimation.vars.id) {
      declaredAnimation.vars.id = "[no id]";
    }

    _merge();

    updateList();

    var savedAnimation = _getAnimationById(recall("animation"));

    if (savedAnimation) {
      savedAnimation._inProgress = recall("in") || 0;
      savedAnimation._outProgress = recall("out") || 100;
    }

    vars.paused && pause();
    selectedAnimation = null;
    animation(declaredAnimation || savedAnimation || _recordedRoot);
    var ts = vars.timeScale || recall("timeScale"),
        savedInOut = savedAnimation === selectedAnimation;

    if (ts) {
      _selectValue(timeScale, ts, timeScaleLabel, ts + "x");

      linkedAnimation.timeScale(ts);
    }

    inProgress = ("inTime" in vars ? _timeToProgress(vars.inTime, selectedAnimation, 0, 0) : savedInOut ? savedAnimation._inProgress : 0) || 0;

    if (inProgress === 100 && !vars.animation && savedAnimation) {
      //in case there's a recorded animation (sessionStorage) and then the user defines an inTime that exceeds that animation's duration, just default back to the Global Timeline. Otherwise the in/out point will be at the very end and it'd be weird.
      animation(_recordedRoot);
      inProgress = _timeToProgress(vars.inTime, selectedAnimation, 0, 0) || 0;
    }

    if (inProgress) {
      inPoint.style.left = inProgress + "%";
      inPoint.style.display = outPoint.style.display = "block"; //set display:block so that it remains visible even when the minimal skin is enabled.
    }

    outProgress = ("outTime" in vars ? _timeToProgress(vars.outTime, selectedAnimation, 100, inProgress) : savedInOut ? savedAnimation._outProgress : 0) || 100;

    if (outProgress < inProgress) {
      outProgress = 100;
    }

    if (outProgress !== 100) {
      outPoint.style.left = outProgress + "%";
      inPoint.style.display = outPoint.style.display = "block"; //set display:block so that it remains visible even when the minimal skin is enabled.
    }

    loopEnabled = "loop" in vars ? vars.loop : recall("loop");
    loopEnabled && loop(true);
    vars.paused && linkedAnimation.progress(inProgress / 100, true).pause();

    if (_startupPhase && selectedAnimation === _recordedRoot && _globalStartTime && vars.globalSync && !paused) {
      linkedAnimation.time(-_globalStartTime, true);
    }

    updateProgress(true);
  }; //INITIALIZATION TASKS


  _addListener(list, "change", onChangeAnimation);

  _addListener(list, "mousedown", updateList);

  _addListener(playPauseButton, "mousedown", togglePlayPause);

  _addListener(find(".seek-bar"), "mousedown", onPressSeekBar);

  _addListener(find(".rewind"), "mousedown", onPressRewind);

  _addListener(loopButton, "mousedown", toggleLoop);

  _addListener(timeScale, "change", onChangeTimeScale);

  if (vars.visibility === "auto") {
    _addListener(root, "mouseout", onMouseOut); //_addListener(find(".gs-hit-area"), "mouseover", show);


    _addListener(root, "mouseover", show);
  } else if (vars.visibility === "hidden") {
    hidden = true;
    autoHideTween.progress(1);
  }

  if (vars.keyboard !== false) {
    if (_keyboardInstance && vars.keyboard) {
      console.warn("[GSDevTools warning] only one instance can be affected by keyboard shortcuts. There is already one active.");
    } else {
      _keyboardInstance = _self; //we can't have multiple instances all affected by the keyboard.

      keyboardHandler = function keyboardHandler(e) {
        //window.parent allows things to work inside of an iframe, like on codepen.
        var key = e.keyCode ? e.keyCode : e.which,
            ts;

        if (key === 32) {
          //spacebar
          togglePlayPause();
        } else if (key === 38) {
          //up arrow
          ts = parseFloat(_shiftSelectedValue(timeScale, -1, timeScaleLabel));
          linkedAnimation.timeScale(ts);
          record("timeScale", ts);
        } else if (key === 40) {
          //down arrow
          ts = parseFloat(_shiftSelectedValue(timeScale, 1, timeScaleLabel));
          linkedAnimation.timeScale(ts);
          record("timeScale", ts);
        } else if (key === 37) {
          //left arrow
          onPressRewind(e);
        } else if (key === 39) {
          //right arrow
          linkedAnimation.progress(outProgress / 100);
        } else if (key === 76) {
          //"L" key
          toggleLoop();
        } else if (key === 72) {
          //"H" key
          toggleHide();
        } else if (key === 73) {
          //"I" key
          inProgress = linkedAnimation.progress() * 100;
          record("in", inProgress);
          inPoint.style.left = inProgress + "%";
          updateProgress(true);
        } else if (key === 79) {
          //"O" key
          outProgress = linkedAnimation.progress() * 100;
          record("out", outProgress);
          outPoint.style.left = outProgress + "%";
          updateProgress(true);
        }
      };

      _addListener(_docEl, "keydown", keyboardHandler);
    }
  }

  gsap.set(playhead, {
    xPercent: -50,
    x: 0,
    data: "root"
  }); //so that when we drag, x is properly discerned (browsers report in pure pixels rather than percents)

  gsap.set(inPoint, {
    xPercent: -100,
    x: 0,
    data: "root"
  });
  inPoint._gsIgnore = outPoint._gsIgnore = playhead._gsIgnore = playPauseButton._gsIgnore = loopButton._gsIgnore = true; //Draggable fires off a TweenLite.set() that affects the transforms, and we don't want them to get into the _recordedRoot, so kill those tweens.

  gsap.killTweensOf([inPoint, outPoint, playhead]);
  initialize(_startupPhase);

  if (_startupPhase) {
    //developers may call GSDevTools.create() before they even create some of their animations, so the inTime/outTime or animation values may not exist, thus we wait for 1 tick and initialize again, just in case.
    _delayedCall(0.0001, initialize, [false], this);
  }

  gsap.ticker.add(updateProgress);

  this.update = function (forceMerge) {
    if (_rootInstance === _self) {
      if (!_rootTween.paused() || forceMerge) {
        _merge();
      }

      updateRootDuration();
    }
  };

  this.kill = this.revert = function () {
    _removeListener(list, "change", onChangeAnimation);

    _removeListener(list, "mousedown", updateList);

    _removeListener(playPauseButton, "mousedown", togglePlayPause);

    _removeListener(find(".seek-bar"), "mousedown", onPressSeekBar);

    _removeListener(find(".rewind"), "mousedown", onPressRewind);

    _removeListener(loopButton, "mousedown", toggleLoop);

    _removeListener(timeScale, "change", onChangeTimeScale);

    progressDrag.disable();
    inDrag.disable();
    outDrag.disable();
    gsap.ticker.remove(updateProgress);

    _removeListener(root, "mouseout", onMouseOut);

    _removeListener(root, "mouseover", show);

    root.parentNode.removeChild(root);

    if (_rootInstance === _self) {
      _rootInstance = null;
    }

    if (_keyboardInstance === _self) {
      _keyboardInstance = null;

      _removeListener(_docEl, "keydown", keyboardHandler);
    }

    delete _lookup[vars.id + ""];
  };

  this.minimal = function (value) {
    var isMinimal = root.classList.contains("minimal"),
        p;

    if (!arguments.length || isMinimal === value) {
      return isMinimal;
    }

    if (value) {
      root.classList.add("minimal");
    } else {
      root.classList.remove("minimal");
    }

    if (vars.container) {
      root.style.top = value ? "calc(100% - 42px)" : "calc(100% - 51px)";
    }

    if (progressDrag.isPressed) {
      skipDragUpdates = true; //just in case there's actually a tween/timeline in the linkedAnimation that is altering this GSDevTool instance's "minimal()" value, it could trigger a recursive loop in the drag handlers, like if they update linkedAnimation's time/progress which in turn triggers this minimal() function which in turn dues the same, and so on.

      progressDrag.endDrag(progressDrag.pointerEvent);
      skipDragUpdates = false;
      p = linkedAnimation.progress() * 100;
      progressBar.style.width = Math.max(0, p - inProgress) + "%";
      playhead.style.left = p + "%";
      playhead.style.transform = "translate(-50%,0)";
      playhead._gsap.x = "0px";
      playhead._gsap.xPercent = -50;
      progressDrag.startDrag(progressDrag.pointerEvent, true);
    }
  }; //expose methods:


  this.animation = animation;
  this.updateList = updateList;

  _context(this);
}; //if on startup, someone does a timeline.seek(), we need to honor it, so when initialize() is called, it'll check the _recordedRoot._start so that we can use that as an offset. Remember, however, that we call initialize() twice on startup, once after a tick has elapsed just in case someone called GSDevTools.create() before their animation code, so we must record the value (once).


GSDevTools.version = "3.12.2";
GSDevTools.globalRecordingTime = 2;

GSDevTools.getById = function (id) {
  return id ? _lookup[id] : _rootInstance;
};

GSDevTools.getByAnimation = function (animation) {
  if (_isString(animation)) {
    animation = gsap.getById(animation);
  }

  for (var p in _lookup) {
    if (_lookup[p].animation() === animation) {
      return _lookup[p];
    }
  }
};

GSDevTools.create = function (vars) {
  return new GSDevTools(vars);
};

GSDevTools.register = _initCore;
_getGSAP() && gsap.registerPlugin(GSDevTools);
export { GSDevTools, GSDevTools as default };