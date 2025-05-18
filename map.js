// map.js

// 1) Imports
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3      from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// 2) Mapbox setup
mapboxgl.accessToken = 'pk.eyJ1IjoiamFja3l1ZTI1MTEiLCJhIjoiY21hc3ZnYzByMHF2czJqb2h5N3lmbzFyOSJ9.EgCj9-XaMPbirr9skDzP6g';
const map = new mapboxgl.Map({
  container: 'map',
  style:     'mapbox://styles/mapbox/streets-v12',
  center:    [-71.09415, 42.36027],
  zoom:       12,
  minZoom:    5,
  maxZoom:   18
});

// 3) Helper functions
function getCoords(station) {
  const pt = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(pt);
  return { cx: x, cy: y };
}

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// 4) Buckets for performance
const departuresByMinute = Array.from({ length: 1440 }, () => []);
const arrivalsByMinute   = Array.from({ length: 1440 }, () => []);

// 5) Compute traffic per station
function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) return tripsByMinute.flat();

  const minMin = (minute - 60 + 1440) % 1440;
  const maxMin = (minute + 60) % 1440;

  if (minMin > maxMin) {
    return [
      ...tripsByMinute.slice(minMin),
      ...tripsByMinute.slice(0, maxMin)
    ].flat();
  } else {
    return tripsByMinute.slice(minMin, maxMin).flat();
  }
}

function computeStationTraffic(stations, timeFilter = -1) {
  const dep = d3.rollup(
    filterByMinute(departuresByMinute, timeFilter),
    v => v.length,
    d => d.start_station_id
  );

  const arr = d3.rollup(
    filterByMinute(arrivalsByMinute, timeFilter),
    v => v.length,
    d => d.end_station_id
  );

  return stations.map(station => {
    const id = station.short_name;
    station.departures   = dep.get(id) ?? 0;
    station.arrivals     = arr.get(id) ?? 0;
    station.totalTraffic = station.departures + station.arrivals;
    return station;
  });
}

// 6) Main
map.on('load', async () => {
  // 6a) Add bike lanes
  const paint = { 'line-color': '#32D400', 'line-width': 5, 'line-opacity': 0.6 };
  map.addSource('boston_route', { type: 'geojson', data:
    'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson'
  });
  map.addLayer({ id: 'boston-lanes', type: 'line', source: 'boston_route', paint });

  map.addSource('cambridge_route', { type: 'geojson', data:
    'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson'
  });
  map.addLayer({ id: 'cambridge-lanes', type: 'line', source: 'cambridge_route', paint });

  // 6b) Load stations
  const sd = await d3.json('https://dsc106.com/labs/lab07/data/bluebikes-stations.json');
  let stations = sd.data.stations;

  // 6c) Load & bucket trips
  await d3.csv(
    'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
    trip => {
      trip.started_at = new Date(trip.started_at);
      trip.ended_at   = new Date(trip.ended_at);
      const sM = minutesSinceMidnight(trip.started_at);
      departuresByMinute[sM].push(trip);
      const eM = minutesSinceMidnight(trip.ended_at);
      arrivalsByMinute[eM].push(trip);
      return trip;
    }
  );

  // 6d) Initial traffic & scales
  stations = computeStationTraffic(stations);
  let radiusScale = d3.scaleSqrt()
    .domain([0, d3.max(stations, d => d.totalTraffic)])
    .range([0, 25]);

  // Quantize scale for flow ratio
  const stationFlow = d3.scaleQuantize()
    .domain([0, 1])
    .range([0, 0.5, 1]);

  // 6e) Draw circles
  const svg = d3.select('#map').select('svg');
  let circles = svg
    .selectAll('circle')
    .data(stations, d => d.short_name)
    .enter()
    .append('circle')
      .attr('r', d => radiusScale(d.totalTraffic))
      .style('--departure-ratio', d => stationFlow(d.departures / d.totalTraffic))
      .each(function(d) {
        d3.select(this).append('title')
          .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
      })
      .attr('fill', 'steelblue')
      .attr('stroke', 'white')
      .attr('stroke-width', 1)
      .attr('opacity', 0.8);

  // 6f) Position update
  function updatePositions() {
    circles
      .attr('cx', d => getCoords(d).cx)
      .attr('cy', d => getCoords(d).cy);
  }
  updatePositions();
  ['move','zoom','resize','moveend'].forEach(evt => map.on(evt, updatePositions));

  // 6g) Scatter update
  function updateScatterPlot(timeFilter) {
    // dynamic radius range
    timeFilter === -1
      ? radiusScale.range([0, 25])
      : radiusScale.range([3, 50]);

    const updated = computeStationTraffic(stations, timeFilter);
    circles = svg
      .selectAll('circle')
      .data(updated, d => d.short_name)
      .join(
        enter => enter.append('circle')
          .attr('r', d => radiusScale(d.totalTraffic))
          .style('--departure-ratio', d => stationFlow(d.departures / d.totalTraffic))
          .each(function(d) {
            d3.select(this).append('title')
              .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
          })
          .attr('fill', 'steelblue')
          .attr('stroke', 'white')
          .attr('stroke-width', 1)
          .attr('opacity', 0.8),
        update => update
          .attr('r', d => radiusScale(d.totalTraffic))
          .style('--departure-ratio', d => stationFlow(d.departures / d.totalTraffic)),
        exit => exit.remove()
      );
    updatePositions();
  }

  // 6h) Slider reactivity
  const timeSlider    = document.getElementById('time-slider');
  const selectedTime  = document.getElementById('selected-time');
  const anyTimeLabel  = document.getElementById('any-time');

  function updateTimeDisplay() {
    const tf = Number(timeSlider.value);
    if (tf === -1) {
      selectedTime.textContent = '';
      anyTimeLabel.style.display = 'block';
    } else {
      selectedTime.textContent = formatTime(tf);
      anyTimeLabel.style.display = 'none';
    }
    updateScatterPlot(tf);
  }

  timeSlider.addEventListener('input', updateTimeDisplay);
  updateTimeDisplay();

  // 6i) Controls
  map.addControl(new mapboxgl.NavigationControl(), 'top-right');
});