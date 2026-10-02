import re

file_path = r'E:\source\repos\ml_dashboard\apps/web/src\App.tsx'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace AppRoute inside Switch with standard Route to prevent Wouter bugs
router_pattern = re.compile(r'<Switch>.*?</Switch>', re.DOTALL)

new_switch = '''<Switch>
              {/* Redirects */}
              <Route path="/ml-hub"><Redirect to="/ml-studio" /></Route>
              <Route path="/rl-console"><Redirect to="/ml-studio" /></Route>
              <Route path="/risk"><Redirect to="/ml-studio" /></Route>
              <Route path="/portfolio"><Redirect to="/ml-studio" /></Route>
              <Route path="/watchlist"><Redirect to="/" /></Route>
              
              {/* Routes rendered in the side panel */}
              <Route path="/news"><ErrorBoundary><Suspense fallback={<DataGridSkeleton />}><News /></Suspense></ErrorBoundary></Route>
              <Route path="/databases"><ErrorBoundary><Suspense fallback={<DataGridSkeleton />}><Databases /></Suspense></ErrorBoundary></Route>
              <Route path="/ml-studio"><ErrorBoundary><Suspense fallback={<PageLoader />}><MLStudio /></Suspense></ErrorBoundary></Route>
              <Route path="/forecast"><ErrorBoundary><Suspense fallback={<PageLoader />}><Forecast /></Suspense></ErrorBoundary></Route>
              <Route path="/curriculum"><ErrorBoundary><Suspense fallback={<PageLoader />}><Curriculum /></Suspense></ErrorBoundary></Route>
              <Route path="/model-catalog"><ErrorBoundary><Suspense fallback={<PageLoader />}><ModelCatalog /></Suspense></ErrorBoundary></Route>
              <Route path="/glossary"><ErrorBoundary><Suspense fallback={<PageLoader />}><Glossary /></Suspense></ErrorBoundary></Route>
              <Route path="/fourier"><ErrorBoundary><Suspense fallback={<PageLoader />}><FourierTransform /></Suspense></ErrorBoundary></Route>
              <Route path="/paper"><ErrorBoundary><Suspense fallback={<DataGridSkeleton />}><Paper /></Suspense></ErrorBoundary></Route>
              <Route path="/terminals"><ErrorBoundary><Suspense fallback={<PageLoader />}><Terminals /></Suspense></ErrorBoundary></Route>
              <Route path="/hardware"><ErrorBoundary><Suspense fallback={<PageLoader />}><Hardware /></Suspense></ErrorBoundary></Route>
              <Route path="/lens"><ErrorBoundary><Suspense fallback={<PageLoader />}><Lens /></Suspense></ErrorBoundary></Route>
              <Route path="/marimo"><ErrorBoundary><Suspense fallback={<PageLoader />}><Marimo /></Suspense></ErrorBoundary></Route>
              <Route path="/live-execution"><ErrorBoundary><Suspense fallback={<PageLoader />}><LiveExecution /></Suspense></ErrorBoundary></Route>
              <Route path="/settings"><ErrorBoundary><Suspense fallback={<PageLoader />}><Settings /></Suspense></ErrorBoundary></Route>
              <Route path="/training"><ErrorBoundary><Suspense fallback={<PageLoader />}><Training /></Suspense></ErrorBoundary></Route>

              {/* Catch-all */}
              <Route>
                <ErrorBoundary>
                  <Suspense fallback={<PageLoader />}>
                    <NotFound />
                  </Suspense>
                </ErrorBoundary>
              </Route>
            </Switch>'''

content = router_pattern.sub(new_switch, content)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("SUCCESS: Updated App.tsx Switch")
