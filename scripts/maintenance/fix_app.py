import re

file_path = r'E:\source\repos\ml_dashboard\apps/web/src\App.tsx'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace the div structure in Router
router_pattern = re.compile(r'<div className="relative flex-1 w-full h-full overflow-hidden".*?</div>\s*</Layout>', re.DOTALL)

new_structure = '''<div className="flex flex-row flex-1 w-full h-full overflow-hidden">
        {/* Persistent Background Layer: The Global Chart */}
        <div className="flex-1 relative z-0 bg-neutral-950">
          <ErrorBoundary>
            <Suspense fallback={<ChartSkeleton />}>
              <MarketData />
            </Suspense>
          </ErrorBoundary>
        </div>

        {/* Foreground Overlay Layer */}
        {!isMarketData && (
          <div className="w-[45%] min-w-[500px] max-w-[700px] shrink-0 z-10 bg-neutral-950/90 backdrop-blur-2xl border-l border-white/5 shadow-[0_0_50px_rgba(0,0,0,0.5)] flex flex-col animate-in slide-in-from-right-8 duration-300">
            <Switch>
              {/* Redirects */}
              <Route path="/ml-hub"><Redirect to="/ml-studio" /></Route>
              <Route path="/rl-console"><Redirect to="/ml-studio" /></Route>
              <Route path="/risk"><Redirect to="/ml-studio" /></Route>
              <Route path="/portfolio"><Redirect to="/ml-studio" /></Route>
              <Route path="/watchlist"><Redirect to="/" /></Route>
              
              {/* Routes rendered in the side panel */}
              <AppRoute path="/news" component={News} fallback={<DataGridSkeleton />} />
              <AppRoute path="/databases" component={Databases} fallback={<DataGridSkeleton />} />
              <AppRoute path="/ml-studio" component={MLStudio} />
              <AppRoute path="/forecast" component={Forecast} />
              <AppRoute path="/curriculum" component={Curriculum} />
              <AppRoute path="/model-catalog" component={ModelCatalog} />
              <AppRoute path="/glossary" component={Glossary} />
              <AppRoute path="/fourier" component={FourierTransform} />
              <AppRoute path="/paper" component={Paper} fallback={<DataGridSkeleton />} />
              <AppRoute path="/terminals" component={Terminals} />
              <AppRoute path="/hardware" component={Hardware} />
              <AppRoute path="/lens" component={Lens} />
              <AppRoute path="/marimo" component={Marimo} />
              <AppRoute path="/live-execution" component={LiveExecution} />
              <AppRoute path="/settings" component={Settings} />
              <AppRoute path="/training" component={Training} />

              {/* Catch-all */}
              <Route>
                <ErrorBoundary>
                  <Suspense fallback={<PageLoader />}>
                    <NotFound />
                  </Suspense>
                </ErrorBoundary>
              </Route>
            </Switch>
          </div>
        )}
      </div>
    </Layout>'''

content = router_pattern.sub(new_structure, content)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
