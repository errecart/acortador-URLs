const form = document.querySelector('#create-form');
const urlInput = document.querySelector('#destination-url');
const formMessage = document.querySelector('#form-message');
const linksList = document.querySelector('#links-list');
const linkCount = document.querySelector('#link-count');

function setMessage(message, type = '') {
  formMessage.textContent = message;
  formMessage.className = `form-message${type ? ` form-message-${type}` : ''}`;
}

async function request(path, options) {
  const response = await fetch(path, options);
  if (!response.ok) {
    let message = `No se pudo completar la solicitud (${response.status}).`;
    try {
      const body = await response.json();
      if (typeof body.error === 'string') {
        message = body.error;
      }
    } catch {
      // Keep the status-based message when the response has no JSON body.
    }
    throw new Error(message);
  }
  return response.status === 204 ? null : response.json();
}

function createLinkCard(link) {
  const card = document.createElement('article');
  card.className = 'link-card';

  const main = document.createElement('div');
  main.className = 'link-main';

  const shortUrl = document.createElement('a');
  shortUrl.className = 'short-url';
  shortUrl.href = `/${encodeURIComponent(link.code)}`;
  shortUrl.textContent = `${window.location.origin}/${link.code}`;
  shortUrl.target = '_blank';
  shortUrl.rel = 'noopener noreferrer';

  const destination = document.createElement('p');
  destination.className = 'destination-url';
  destination.textContent = link.url;

  main.append(shortUrl, destination);

  const details = document.createElement('div');
  details.className = 'link-details';

  const visits = document.createElement('span');
  visits.className = 'visit-count';
  visits.textContent = `${link.visits} ${link.visits === 1 ? 'visita' : 'visitas'}`;

  const actions = document.createElement('div');
  actions.className = 'link-actions';

  const copyButton = document.createElement('button');
  copyButton.className = 'button button-secondary';
  copyButton.type = 'button';
  copyButton.textContent = 'Copiar';
  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(shortUrl.href);
      copyButton.textContent = '¡Copiado!';
      window.setTimeout(() => {
        copyButton.textContent = 'Copiar';
      }, 1800);
    } catch {
      setMessage('No se pudo copiar. Revisá los permisos del navegador.', 'error');
    }
  });

  const deleteButton = document.createElement('button');
  deleteButton.className = 'button button-delete';
  deleteButton.type = 'button';
  deleteButton.textContent = 'Borrar';
  deleteButton.setAttribute('aria-label', `Borrar enlace ${link.code}`);
  deleteButton.addEventListener('click', async () => {
    deleteButton.disabled = true;
    try {
      await request(`/api/links/${encodeURIComponent(link.code)}`, { method: 'DELETE' });
      await loadLinks();
      setMessage('Enlace borrado.', 'success');
    } catch (error) {
      deleteButton.disabled = false;
      setMessage(error.message, 'error');
    }
  });

  actions.append(copyButton, deleteButton);
  details.append(visits, actions);
  card.append(main, details);
  return card;
}

function renderLinks(links) {
  linksList.replaceChildren();
  linkCount.textContent = `${links.length} ${links.length === 1 ? 'enlace' : 'enlaces'}`;

  if (links.length === 0) {
    const emptyState = document.createElement('div');
    emptyState.className = 'empty-state';

    const icon = document.createElement('span');
    icon.className = 'empty-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '↗';

    const title = document.createElement('h3');
    title.textContent = 'Todavía no hay enlaces';

    const description = document.createElement('p');
    description.textContent = 'Creá tu primer enlace corto y va a aparecer acá.';

    emptyState.append(icon, title, description);
    linksList.append(emptyState);
    return;
  }

  for (const link of links) {
    linksList.append(createLinkCard(link));
  }
}

async function loadLinks() {
  linksList.setAttribute('aria-busy', 'true');
  try {
    const links = await request('/api/links');
    renderLinks(links);
  } catch (error) {
    linksList.replaceChildren();
    const message = document.createElement('p');
    message.className = 'load-error';
    message.textContent = error.message;
    linksList.append(message);
  } finally {
    linksList.removeAttribute('aria-busy');
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  setMessage('');

  try {
    await request('/api/links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: urlInput.value.trim() }),
    });
    form.reset();
    setMessage('Tu enlace ya está listo.', 'success');
    await loadLinks();
  } catch (error) {
    setMessage(error.message, 'error');
  } finally {
    submitButton.disabled = false;
  }
});

loadLinks();
