import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeLuxSchedules, parseLuxCinemaPage, scrapeLuxDirectory } from '../scrapers/other-circuits.js';

function varint(value) {
  let n = BigInt(value);
  const bytes = [];
  while (n > 127n) {
    bytes.push(Number(n & 127n) | 0x80);
    n >>= 7n;
  }
  bytes.push(Number(n));
  return Buffer.from(bytes);
}

function field(number, wire, bytes) {
  return Buffer.concat([varint((number << 3) | wire), bytes]);
}

function stringField(number, value) {
  const bytes = Buffer.from(value, 'utf8');
  return Buffer.concat([varint((number << 3) | 2), varint(bytes.length), bytes]);
}

function intField(number, value) {
  return field(number, 0, varint(value));
}

function grpcFrame(payload, flags = 0) {
  const header = Buffer.alloc(5);
  header[0] = flags;
  header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

function grpcResponse(payload) {
  return Buffer.concat([grpcFrame(payload), grpcFrame(Buffer.from('grpc-status:0\r\ngrpc-message:\r\n'), 0x80)]);
}

function int64Field(number, value) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigInt64LE(BigInt(value));
  return field(number, 1, bytes);
}

const cinemaUuid = '0ab2c645-1ba1-4b43-94ce-da1d2cf78077';
const movieUuid = 'd0b8bb58-37bf-475d-be91-231c8d5f6bbb';
const showUuid = 'dcd99ea3-4b19-4c80-ae3d-edc8a82557bd';
const scheduleDate = 1790294400;
const startAt = 1790318100;

function cinemaPage() {
  return parseLuxCinemaPage(`<script>window.__NUXT__={data:[{cinema:{uuid:${JSON.stringify(cinemaUuid)},name:"寶石戲院",address:"紅磡寶其利街2號J"},showDates:[${scheduleDate}],showList:[]}]}</script>`).page;
}

function scheduleResponse({ includeShowUrl = false, attendance = -1 } = {}) {
  const movie = Buffer.concat([
    stringField(1, movieUuid),
    stringField(2, '生化危機'),
    intField(3, scheduleDate),
    stringField(4, 'https://storage.movie6.com/movie/poster.jpg'),
    intField(9, 98),
    stringField(14, '電影簡介'),
  ]);
  const show = Buffer.concat([
    stringField(1, 'House 1'),
    intField(2, startAt),
    intField(3, 50),
    stringField(5, showUuid),
    int64Field(12, attendance),
    ...(includeShowUrl ? [stringField(13, 'https://tickets.example/show/1')] : []),
  ]);
  const row = Buffer.concat([
    field(1, 2, Buffer.concat([varint(movie.length), movie])),
    stringField(2, '2D'),
    field(3, 2, Buffer.concat([varint(show.length), show])),
  ]);
  return field(1, 2, Buffer.concat([varint(row.length), row]));
}

test('parses the Lux cinema Nuxt page and validates the cinema UUID', () => {
  const { page, dates } = parseLuxCinemaPage(`<script>window.__NUXT__={data:[{cinema:{uuid:${JSON.stringify(cinemaUuid)}},showDates:[${scheduleDate},${scheduleDate}],showList:[]}]}</script>`);
  assert.equal(page.cinema.uuid, cinemaUuid);
  assert.deepEqual(dates, [scheduleDate]);
  assert.throws(() => parseLuxCinemaPage('<script>window.__NUXT__={data:[{}]}</script>'), /page is not the/);
});

test('normalizes HK Movie 6 movie and show protobuf fields', () => {
  const data = normalizeLuxSchedules(cinemaPage(), [[scheduleDate, scheduleResponse()]]);
  assert.equal(data.cinemas[0].id, 'lux-1');
  assert.equal(data.cinemas[0].nameZh, '寶石戲院');
  assert.equal(data.cinemas[0].address, '紅磡寶其利街2號J');
  assert.equal(data.movies.length, 1);
  assert.equal(data.movies[0].id, 'lux-' + movieUuid);
  assert.equal(data.movies[0].nameZh, '生化危機');
  assert.equal(data.movies[0].duration, 98);
  assert.equal(data.movies[0].poster, 'https://storage.movie6.com/movie/poster.jpg');
  assert.equal(data.shows.length, 1);
  assert.equal(data.shows[0].id, 'lux-' + showUuid);
  assert.equal(data.shows[0].movieId, 'lux-' + movieUuid);
  assert.equal(data.shows[0].houseName, 'House 1');
  assert.equal(data.shows[0].startAt, '2026-09-25T14:35:00.000+08:00');
  assert.equal(data.shows[0].date, '2026-09-25');
  assert.equal(data.shows[0].price, 50);
  assert.equal(data.shows[0].soldOut, false);
  assert.equal(data.shows[0].bookingUrl, 'https://hkmovie6.com/cinema/' + cinemaUuid + '/寶石戲院');
});

test('uses a source show URL when present and decodes signed attendance', () => {
  const data = normalizeLuxSchedules(cinemaPage(), [[scheduleDate, scheduleResponse({ includeShowUrl: true })]]);
  assert.equal(data.shows[0].bookingUrl, 'https://tickets.example/show/1');
  assert.equal(data.shows[0].soldOut, false);

  const soldOut = normalizeLuxSchedules(cinemaPage(), [[scheduleDate, scheduleResponse({ attendance: 1 })]]);
  assert.equal(soldOut.shows[0].soldOut, true);
});

test('scrapes SSR dates through the anonymous-token gRPC flow', async () => {
  const token = 'eyJhbGciOiJIUzUxMiJ9.eyJ1c2VyX2lkIjoiYW5vbnltb3VzIn0.signature';
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).startsWith('https://hkmovie6.com/cinema/')) {
      return new Response(`<script>window.__NUXT__={data:[{cinema:{uuid:${JSON.stringify(cinemaUuid)},name:"寶石戲院"},showDates:[${scheduleDate}],showList:[]}]}</script>`, { status: 200 });
    }
    if (String(url).endsWith('/userpb.API/Anonymous')) {
      const access = stringField(1, token);
      return new Response(grpcResponse(field(1, 2, Buffer.concat([varint(access.length), access]))), { status: 200 });
    }
    assert.equal(String(url), 'https://m6-api.movie6.com/showpb.ShowAPI/ListByCinemaAndDate');
    assert.equal(options.headers.authorization, token);
    const requestFrame = Buffer.from(options.body);
    const payload = requestFrame.subarray(5, 5 + requestFrame.readUInt32BE(1));
    const requestFields = payload.toString('hex');
    assert.match(requestFields, /0a2430616232633634352d316261312d346234332d393463652d646131643263663738303737/);
    return new Response(grpcResponse(scheduleResponse()), { status: 200 });
  };

  const data = await scrapeLuxDirectory({ fetchImpl });
  assert.equal(requests.length, 3);
  assert.equal(requests[0].url, 'https://hkmovie6.com/cinema/' + cinemaUuid + '/寶石戲院');
  assert.equal(requests[1].url, 'https://m6-api.movie6.com/userpb.API/Anonymous');
  assert.equal(data.shows[0].id, 'lux-' + showUuid);
});
