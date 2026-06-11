export function buildSearchUrl(platform: string, item: { title: string; type: string }, dest: string, dates?: { start: string; end: string }): string {
  const kw = encodeURIComponent(item.title);
  const destEnc = encodeURIComponent(dest);
  switch (platform) {
    case 'ctrip':
      if (item.type === 'traffic') return `https://flights.ctrip.com/search?keyword=${destEnc}`;
      if (item.type === 'attraction') return `https://you.ctrip.com/searchsite/?query=${kw}`;
      const params = new URLSearchParams();
      params.set('countryId', '0');
      params.set('city', '0');
      params.set('optionId', '0');
      params.set('optionType', 'Keyword');
      params.set('directSearch', '1');
      params.set('display', item.title);
      if (dates?.start) params.set('checkin', dates.start.split('T')[0]);
      if (dates?.end) params.set('checkout', dates.end.split('T')[0]);
      return `https://hotels.ctrip.com/hotels/list?${params.toString()}`;
    case 'fliggy':
      return `https://www.fliggy.com/ifi/search.htm?q=${kw}`;
    case 'tongcheng':
      if (item.type === 'traffic') return `https://www.ly.com/flights/search?keyword=${destEnc}`;
      if (item.type === 'attraction') return `https://www.ly.com/scenery/search?keyword=${destEnc}`;
      return `https://m.ly.com/hotel/search?keyword=${kw}`;
    default:
      return '#';
  }
}
