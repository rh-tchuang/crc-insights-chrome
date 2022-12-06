import React, { Suspense, lazy, memo, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ScalprumProvider, ScalprumProviderProps } from '@scalprum/react-core';
import { shallowEqual, useSelector, useStore } from 'react-redux';
import { Route, Routes } from 'react-router-dom';
import { HelpTopicContext } from '@patternfly/quickstarts';
import isEqual from 'lodash/isEqual';
import { AppsConfig } from '@scalprum/core';
import { ChromeAPI } from '@redhat-cloud-services/types';

import chromeHistory from '../../utils/chromeHistory';
import DefaultLayout from '../../layouts/DefaultLayout';
import NavLoader from '../Navigation/Loader';
import historyListener from '../../utils/historyListener';
import SegmentContext from '../../analytics/SegmentContext';
import LoadingFallback from '../../utils/loading-fallback';
import { ReduxState } from '../../redux/store';
import { FlagTagsFilter, HelpTopicsAPI, QuickstartsApi } from '../../@types/types';
import { createGetUser } from '../../auth';
import LibtJWTContext from '../LibJWTContext';
import { createChromeContext } from '../../chrome/create-chrome';

const Navigation = lazy(() => import('../Navigation'));
const LandingNav = lazy(() => import('../LandingNav'));
const ProductSelection = lazy(() => import('../Stratosphere/ProductSelection'));

const loaderWrapper = (Component: React.ComponentType, props = {}) => (
  <Suspense fallback={<NavLoader />}>
    <Component {...props} />
  </Suspense>
);

const useGlobalFilter = (callback: (selectedTags?: FlagTagsFilter) => any) => {
  const selectedTags = useSelector(({ globalFilter: { selectedTags } }: ReduxState) => selectedTags, shallowEqual);
  return callback(selectedTags);
};

export type ScalprumRootProps = {
  config: AppsConfig;
  helpTopicsAPI: HelpTopicsAPI;
  quickstartsAPI: QuickstartsApi;
};

const ScalprumRoot = memo(
  ({ config, helpTopicsAPI, quickstartsAPI, ...props }: ScalprumRootProps) => {
    const { setActiveHelpTopicByName, helpTopics, activeHelpTopic, setFilteredHelpTopics } = useContext(HelpTopicContext);
    const { analytics } = useContext(SegmentContext);
    const [activeTopicName, setActiveTopicName] = useState<string | undefined>();
    const [prevActiveTopic, setPrevActiveTopic] = useState<string | undefined>(activeHelpTopic?.name);
    const libJwt = useContext(LibtJWTContext);
    const store = useStore();
    const modulesConfig = useSelector(({ chrome: { modules } }: ReduxState) => modules);

    async function setActiveTopic(name: string) {
      setActiveTopicName(name);
      if (name?.length > 0) {
        helpTopicsAPI.enableTopics(name);
      }
    }

    async function enableTopics(...names: string[]) {
      return helpTopicsAPI.enableTopics(...names).then((res) => {
        setFilteredHelpTopics?.(res);
        return res;
      });
    }

    useEffect(() => {
      const unregister = chromeHistory.listen(historyListener);
      return () => {
        if (typeof unregister === 'function') {
          return unregister();
        }
      };
    }, []);

    useEffect(() => {
      /**
       * We can't call the setActiveHelpTopicByName directly after we populate the context with new value
       * The quickstarts module returns a undefined value
       * TODO: Fix it in the quickstarts repository
       */
      if (prevActiveTopic && activeHelpTopic === null) {
        setActiveTopic('');
        setPrevActiveTopic(undefined);
      } else {
        if (typeof activeTopicName === 'string' && activeTopicName?.length > 0) {
          if (helpTopics?.find(({ name }) => name === activeTopicName)) {
            setActiveHelpTopicByName && setActiveHelpTopicByName(activeTopicName);
            setPrevActiveTopic(activeTopicName);
          }
        } else {
          setActiveHelpTopicByName && setActiveHelpTopicByName('');
          setPrevActiveTopic(undefined);
        }
      }
    }, [activeTopicName, helpTopics]);

    const setPageMetadata = useCallback((pageOptions) => {
      window._segment = {
        ...window._segment,
        pageOptions,
      };
    }, []);

    const getUser = useCallback(createGetUser(libJwt), [libJwt]);
    const helpTopicsChromeApi = useMemo(
      () => ({
        ...helpTopicsAPI,
        setActiveTopic,
        enableTopics,
        closeHelpTopic: () => {
          setActiveTopic('');
        },
      }),
      []
    );
    const chromeApi = useMemo(
      () =>
        createChromeContext({
          analytics: analytics!,
          getUser,
          helpTopics: helpTopicsChromeApi,
          libJwt,
          modulesConfig,
          quickstartsAPI,
          useGlobalFilter,
          store,
          setPageMetadata,
        }),
      []
    );

    const scalprumProviderProps: ScalprumProviderProps<{ chrome: ChromeAPI }> = useMemo(() => {
      // set the deprecated chrome API to window
      window.insights.chrome = chromeApi;
      return {
        config,
        api: {
          chrome: chromeApi,
        },
      };
    }, []);

    return (
      /**
       * Once all applications are migrated to chrome 2:
       * - define chrome API in chrome root after it mounts
       * - copy these functions to window
       * - add deprecation warning to the window functions
       */
      <ScalprumProvider {...scalprumProviderProps}>
        <Routes>
          <Route index path="/" element={<DefaultLayout Sidebar={loaderWrapper(LandingNav)} {...props} />} />
          <Route
            path="/connect/products"
            element={
              <Suspense fallback={LoadingFallback}>
                <ProductSelection />
              </Suspense>
            }
          />
          <Route path="/connect/*" element={<DefaultLayout {...props} />} />
          <Route path="/security" element={<DefaultLayout {...props} />} />
          <Route path="*" element={<DefaultLayout Sidebar={loaderWrapper(Navigation)} {...props} />} />
        </Routes>
      </ScalprumProvider>
    );
  },
  // config rarely changes
  (prev, next) => isEqual(prev.config, next.config)
);

ScalprumRoot.displayName = 'MemoizedScalprumRoot';

export default ScalprumRoot;