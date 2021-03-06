import {
  applyMiddleware,
  combineReducers,
  createStore,
  Middleware,
} from "redux"
import _ from "lodash"

import { mett } from "../utils/mett"
import thunk, { ThunkMiddleware } from "redux-thunk"
import * as reducers from "./reducers"
import { writeToCache, readFromCache } from "./persist"
import { IGatsbyState, ActionsUnion } from "./types"

// Create event emitter for actions
export const emitter = mett()

// Read old node data from cache.
export const readState = (): IGatsbyState => {
  try {
    const state = readFromCache() as IGatsbyState
    if (state.nodes) {
      // re-create nodesByType
      state.nodesByType = new Map()
      state.nodes.forEach(node => {
        const { type } = node.internal
        if (!state.nodesByType.has(type)) {
          state.nodesByType.set(type, new Map())
        }
        // The `.has` and `.set` calls above make this safe
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        state.nodesByType.get(type)!.set(node.id, node)
      })
    }

    // jsonDataPaths was removed in the per-page-manifest
    // changes. Explicitly delete it here to cover case where user
    // runs gatsby the first time after upgrading.
    delete state[`jsonDataPaths`]
    return state
  } catch (e) {
    // ignore errors.
  }
  // BUG: Would this not cause downstream bugs? seems likely. Why wouldn't we just
  // throw and kill the program?
  return {} as IGatsbyState
}

export interface IMultiDispatch {
  <T extends ActionsUnion>(action: T[]): T[]
}

/**
 * Redux middleware handling array of actions
 */
const multi: Middleware<IMultiDispatch> = ({ dispatch }) => next => (
  action: ActionsUnion
): ActionsUnion | ActionsUnion[] =>
  Array.isArray(action) ? action.filter(Boolean).map(dispatch) : next(action)

// We're using the inferred type here becauise manually typing it would be very complicated
// and error-prone. Instead we'll make use of the createStore return value, and export that type.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export const configureStore = (initialState: IGatsbyState) =>
  createStore(
    combineReducers<IGatsbyState>({ ...reducers }),
    initialState,
    applyMiddleware(thunk as ThunkMiddleware<IGatsbyState, ActionsUnion>, multi)
  )

export type GatsbyReduxStore = ReturnType<typeof configureStore>
export const store: GatsbyReduxStore = configureStore(readState())

// Persist state.
export const saveState = (): void => {
  const state = store.getState()

  return writeToCache({
    nodes: state.nodes,
    status: state.status,
    componentDataDependencies: state.componentDataDependencies,
    components: state.components,
    jobsV2: state.jobsV2,
    staticQueryComponents: state.staticQueryComponents,
    webpackCompilationHash: state.webpackCompilationHash,
    pageDataStats: state.pageDataStats,
    pageData: state.pageData,
    pendingPageDataWrites: state.pendingPageDataWrites,
  })
}

store.subscribe(() => {
  const lastAction = store.getState().lastAction
  emitter.emit(lastAction.type, lastAction)
})
