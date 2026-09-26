import React, { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import AppV2 from './AppV2.jsx'
import SiteTabs, { TABS, tabForPath } from './SiteTabs.jsx'

const DraftBoard = lazy(() => import('./draft-board/DraftBoard.jsx'))

const path = window.location.pathname
const isV1 = path === '/v1' || path.startsWith('/v1/')

// Each tab stays mounted once visited, so switching never loses a half-built
// map or tonight's teams.
function Site() {
  const [active, setActive] = useState(() => tabForPath(window.location.pathname))
  const [visited, setVisited] = useState(() => new Set([tabForPath(window.location.pathname)]))
  const activeRef = useRef(active)
  const scrollByTab = useRef({})

  const show = useCallback((id) => {
    if (id === activeRef.current) return
    scrollByTab.current[activeRef.current] = window.scrollY
    activeRef.current = id
    setActive(id)
    setVisited((v) => (v.has(id) ? v : new Set(v).add(id)))
  }, [])

  useEffect(() => {
    const onPop = () => show(tabForPath(window.location.pathname))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [show])

  useLayoutEffect(() => {
    document.title = TABS.find((t) => t.id === active).title
    window.scrollTo(0, scrollByTab.current[active] || 0)
  }, [active])

  const navigate = (tab) => {
    if (tab.id === activeRef.current) return
    window.history.pushState(null, '', tab.path)
    show(tab.id)
  }

  return (
    <>
      <SiteTabs active={active} onNavigate={navigate} />
      <div className="site-view" hidden={active !== 'map'}>
        {visited.has('map') && <AppV2 />}
      </div>
      <div className="site-view" hidden={active !== 'draft'}>
        {visited.has('draft') && (
          <Suspense fallback={<p className="site-loading">Loading Draft Board…</p>}>
            <DraftBoard />
          </Suspense>
        )}
      </div>
    </>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isV1 ? <App /> : <Site />}
  </React.StrictMode>,
)
