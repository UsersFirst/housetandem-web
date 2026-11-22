// The website: static files from public/, with www forwarded to the main address.
export default {
  fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === 'www.housetandem.com') {
      url.hostname = 'housetandem.com';
      return Response.redirect(url.toString(), 301);
    }
    return env.ASSETS.fetch(request);
  },
};
