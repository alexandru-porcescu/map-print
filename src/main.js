/**
 * This is the website startup point.
 */
import * as osm from './lib/osm';
import appState from './appState';
import bus from './bus';
import constructGraph from './lib/constructGraph';
import formatNumber from './lib/formatNumber';
import mapboxgl from 'mapbox-gl';

var MapboxGeocoder = require('@mapbox/mapbox-gl-geocoder');

// Load vue asyncronously
require.ensure('@/vueApp.js', () => {
  require('@/vueApp.js');
});

// Hold a reference to mapboxgl instance.
let map;
// This will hold a reference to a function which cancels current download
var cancelDownload;

// Let the vue know what to call to start the app.
appState.init = init;

function init() {
  // Please don't use this token. It is bound to my domain and wouldn't work
  // when you deploy to your website.
  mapboxgl.accessToken = 'pk.eyJ1IjoiYW52YWthIiwiYSI6ImNrNWRqcDdnNTF4MHYzbXAzNDJzODludnYifQ.2WDAbuAzUuchNtCAcZitAw';
  map = new mapboxgl.Map({
      container: 'map',
      style: 'mapbox://styles/mapbox/streets-v9',
      center: [-122.2381,47.624],
      zoom: 11.32,
      hash: true
  });

  map.addControl(new mapboxgl.NavigationControl({showCompass: false}), 'bottom-right');
  map.addControl(new MapboxGeocoder({accessToken: mapboxgl.accessToken}));
  map.on('zoom', updateZoomWarning);

  map.dragRotate.disable();
  map.touchZoomRotate.disableRotation();

  // On large screens we want to warn people that they may end up downloading a lot of stuff
  updateZoomWarning();

  bus.on('download-all-roads', downloadRoads);
  bus.on('cancel-download-all-roads', () => {
    if (cancelDownload) cancelDownload();
  });
};

function updateZoomWarning() {
  appState.showZoomWarning = map.getZoom() < 9.7;
}

function downloadRoads() {
  const bounds = map.getBounds();
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast()
  const boundingBox = `${sw.lat},${sw.lng},${ne.lat},${ne.lng}`;

  appState.building = true;
  appState.buildingMessage = 'Sending query to OSM...'
  appState.blank = false;
  appState.error = null;

  const scriptKind = appState.possibleScripts.selected;
  const downloadPromise = osm.getRoadsInBoundingBox(scriptKind, boundingBox, updateDownloadProgress);

  renderAfterResolution(downloadPromise);
}

function renderAfterResolution(downloadPromise) {
  // Since promises do not support cancellation, we have to invent our own.
  // when cancelDownload is set we can cancel the download...
  cancelDownload = downloadPromise.cancel;
  appState.showCancelDownload = true;

  downloadPromise.then(osmResponse => {
    cancelDownload = null;
    appState.showCancelDownload = false;
    return constructGraph(osmResponse, makeFilterInsideBoundingBox(), updateConstructionProgress);
  }).then(({graph, bounds, projector}) => {
    appState.setGraph(graph, bounds, projector);
    appState.building = false;

    if (graph.getLinksCount() === 0) {
      appState.blank = true;
    } else {
      appState.currentState = 'canvas';
      appState.blank = false;
      bus.fire('graph-loaded');
    }
  }).catch(err => {
    if (err && err.cancelled) {
      cancelDownload = null;
      appState.building = false;
      appState.showCancelDownload = false;
    } else {
      appState.building = false;
      appState.error = err;
    }
  });
}

function makeFilterInsideBoundingBox() {
  // Some elements in the OSM response can be outside of the visible box
  // ignore them.
  const bounds = map.getBounds();
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast()

  return filterRoadsOutOfBounds;

  function filterRoadsOutOfBounds(el) {
    return el.lon >= sw.lng && el.lon <= ne.lng &&
            el.lat >= sw.lat && el.lat <= ne.lat;
  }
}

function updateDownloadProgress(p) {
  let loaded = formatNumber(p.loaded);

  if (p.lengthComputable) {
    let total = formatNumber(p.total);
    appState.buildingMessage = `Downloading data: ${p.percent * 100}% (${loaded} of ${total} bytes)`;
  } else {
    appState.buildingMessage = `Downloading data: ${loaded} bytes so far...`;
  }
}


function updateConstructionProgress(current, total, kind) {
  let totalStr = formatNumber(total);
  let currentStr = formatNumber(current);
  if (kind === 'graph') {
    appState.buildingMessage = `Making graph: ${currentStr} of ${totalStr} records`;
  } else {
    appState.buildingMessage = `Computing bounds: ${currentStr} of ${totalStr} records`;
  }
}
