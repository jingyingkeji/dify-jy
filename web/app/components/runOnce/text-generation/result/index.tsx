'use client'
import type { FC } from 'react'
import React, { useEffect, useRef, useState } from 'react'
import { useBoolean } from 'ahooks'
import { t } from 'i18next'
import produce from 'immer'
import cn from '@/utils/classnames'
import NoData from '@/app/components/share/text-generation/no-data'
import Toast from '@/app/components/base/toast'
import { sendWorkflowRun, updateFeedback } from '@/service/share'
import type { FeedbackType } from '@/app/components/base/chat/chat/type'
import Loading from '@/app/components/base/loading'
import type { PromptConfig } from '@/models/debug'
import type { InstalledApp } from '@/models/explore'
import type { ModerationService } from '@/models/common'
import { TransferMethod, type VisionFile, type VisionSettings } from '@/types/app'
import { NodeRunningStatus, WorkflowRunningStatus } from '@/app/components/workflow/types'
import type { WorkflowProcess } from '@/app/components/base/chat/types'
import { sleep } from '@/utils'
import type { SiteInfo } from '@/models/share'
import { TEXT_GENERATION_TIMEOUT_MS } from '@/config'
import {
  getFilesInLogs,
} from '@/app/components/base/file-uploader/utils'
import TracingPanel from '@/app/components/workflow/run/tracing-panel'
import { useStore } from '@/app/components/app/store'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { throttle } from 'lodash-es'

export type IResultProps = {
  isWorkflow: boolean
  isCallBatchAPI: boolean
  isPC: boolean
  isMobile: boolean
  isInstalledApp: boolean
  installedAppInfo?: InstalledApp
  isError: boolean
  isShowTextToSpeech: boolean
  promptConfig: PromptConfig | null
  moreLikeThisEnabled: boolean
  inputs: Record<string, any>
  controlSend?: number
  controlRetry?: number
  controlStopResponding?: number
  onShowRes: () => void
  handleSaveMessage: (messageId: string) => void
  taskId?: number
  onCompleted: (completionRes: string, taskId?: number, success?: boolean) => void
  enableModeration?: boolean
  moderationService?: (text: string) => ReturnType<ModerationService>
  visionConfig: VisionSettings
  completionFiles: VisionFile[]
  siteInfo: SiteInfo | null
  apiKey: string
}

const Result: FC<IResultProps> = ({
  isWorkflow,
  isCallBatchAPI,
  isPC,
  isMobile,
  isInstalledApp,
  installedAppInfo,
  isError,
  isShowTextToSpeech,
  promptConfig,
  moreLikeThisEnabled,
  inputs,
  controlSend,
  controlRetry,
  controlStopResponding,
  onShowRes,
  handleSaveMessage,
  taskId,
  onCompleted,
  visionConfig,
  completionFiles,
  siteInfo,
  apiKey,
}) => {
  const appDetail = useStore(state => state.appDetail)!
  const [isResponding, { setTrue: setRespondingTrue, setFalse: setRespondingFalse }] = useBoolean(false)
  useEffect(() => {
    if (controlStopResponding)
      setRespondingFalse()
  }, [controlStopResponding])

  const [completionRes, doSetCompletionRes] = useState<any>('')
  const completionResRef = useRef<any>()
  const setCompletionRes = (res: any) => {
    completionResRef.current = res
    doSetCompletionRes(res)
  }
  const getCompletionRes = () => completionResRef.current
  const [workflowProcessData, doSetWorkflowProcessData] = useState<WorkflowProcess>()
  const workflowProcessDataRef = useRef<WorkflowProcess>()
  const containerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const renderRef = useRef<HTMLDivElement>(null)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const isInitialMount = useRef(true)
  const setWorkflowProcessData = (data: WorkflowProcess) => {
    workflowProcessDataRef.current = data
    if(isAtBottom) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    doSetWorkflowProcessData(data)
  }
  const getWorkflowProcessData = () => workflowProcessDataRef.current

  const { notify } = Toast
  const isNoData = !completionRes

  const [messageId, setMessageId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<FeedbackType>({
    rating: null,
  })

  const handleFeedback = async (feedback: FeedbackType) => {
    await updateFeedback({ url: `/messages/${messageId}/feedbacks`, body: { rating: feedback.rating } }, isInstalledApp, installedAppInfo?.id)
    setFeedback(feedback)
  }

  const logError = (message: string) => {
    notify({ type: 'error', message })
  }

  const checkCanSend = () => {
    // batch will check outer
    if (isCallBatchAPI)
      return true

    const prompt_variables = promptConfig?.prompt_variables
    if (!prompt_variables || prompt_variables?.length === 0) {
      if (completionFiles.find(item => item.transfer_method === TransferMethod.local_file && !item.upload_file_id)) {
        notify({ type: 'info', message: t('appDebug.errorMessage.waitForFileUpload') })
        return false
      }
      return true
    }

    let hasEmptyInput = ''
    const requiredVars = prompt_variables?.filter(({ key, name, required }) => {
      const res = (!key || !key.trim()) || (!name || !name.trim()) || (required || required === undefined || required === null)
      return res
    }) || [] // compatible with old version
    requiredVars.forEach(({ key, name }) => {
      if (hasEmptyInput)
        return

      if (!inputs[key])
        hasEmptyInput = name
    })

    if (hasEmptyInput) {
      logError(t('appDebug.errorMessage.valueOfVarRequired', { key: hasEmptyInput }))
      return false
    }

    if (completionFiles.find(item => item.transfer_method === TransferMethod.local_file && !item.upload_file_id)) {
      notify({ type: 'info', message: t('appDebug.errorMessage.waitForFileUpload') })
      return false
    }
    return !hasEmptyInput
  }

  const handleSend = async () => {
    if (isResponding) {
      notify({ type: 'info', message: t('appDebug.errorMessage.waitForResponse') })
      return false
    }

    if (!checkCanSend())
      return

    const data: Record<string, any> = {
      inputs,
    }
    if (visionConfig.enabled && completionFiles && completionFiles?.length > 0) {
      data.files = completionFiles.map((item) => {
        if (item.transfer_method === TransferMethod.local_file) {
          return {
            ...item,
            url: '',
          }
        }
        return item
      })
    }

    setMessageId(null)
    setFeedback({
      rating: null,
    })
    setCompletionRes('')

    const res: string[] = []
    let tempMessageId = ''

    if (!isPC)
      onShowRes()

    setRespondingTrue()
    let isEnd = false
    let isTimeout = false;
    (async () => {
      await sleep(TEXT_GENERATION_TIMEOUT_MS)
      if (!isEnd) {
        setRespondingFalse()
        onCompleted(getCompletionRes(), taskId, false)
        isTimeout = true
      }
    })()
    data.user = 'test'
    if (isWorkflow) {
      sendWorkflowRun(
        data,
        {
          onWorkflowStarted: ({ workflow_run_id }) => {
            tempMessageId = workflow_run_id
            setWorkflowProcessData({
              status: WorkflowRunningStatus.Running,
              tracing: [],
              expand: false,
              resultText: '',
            })
          },
          onIterationStart: ({ data }) => {
            setWorkflowProcessData(produce(getWorkflowProcessData()!, (draft) => {
              draft.expand = true
              draft.tracing!.push({
                ...data,
                status: NodeRunningStatus.Running,
                expand: true,
              } as any)
            }))
          },
          onIterationNext: () => {
            setWorkflowProcessData(produce(getWorkflowProcessData()!, (draft) => {
              draft.expand = true
              const iterations = draft.tracing.find(item => item.node_id === data.node_id
                && (item.execution_metadata?.parallel_id === data.execution_metadata?.parallel_id || item.parallel_id === data.execution_metadata?.parallel_id))!
              iterations?.details!.push([])
            }))
          },
          onIterationFinish: ({ data }) => {
            setWorkflowProcessData(produce(getWorkflowProcessData()!, (draft) => {
              draft.expand = true
              const iterationsIndex = draft.tracing.findIndex(item => item.node_id === data.node_id
                && (item.execution_metadata?.parallel_id === data.execution_metadata?.parallel_id || item.parallel_id === data.execution_metadata?.parallel_id))!
              draft.tracing[iterationsIndex] = {
                ...data,
                expand: !!data.error,
              } as any
            }))
          },
          onNodeStarted: ({ data }) => {
            if (data.iteration_id)
              return

            setWorkflowProcessData(produce(getWorkflowProcessData()!, (draft) => {
              draft.expand = true
              draft.tracing!.push({
                ...data,
                status: NodeRunningStatus.Running,
                expand: true,
              } as any)
            }))
          },
          onNodeFinished: ({ data }) => {
            if (data.iteration_id)
              return

            setWorkflowProcessData(produce(getWorkflowProcessData()!, (draft) => {
              const currentIndex = draft.tracing!.findIndex(trace => trace.node_id === data.node_id
                && (trace.execution_metadata?.parallel_id === data.execution_metadata?.parallel_id || trace.parallel_id === data.execution_metadata?.parallel_id))
              if (currentIndex > -1 && draft.tracing) {
                draft.tracing[currentIndex] = {
                  ...(draft.tracing[currentIndex].extras
                    ? { extras: draft.tracing[currentIndex].extras }
                    : {}),
                  ...data,
                  expand: !!data.error,
                } as any
              }
            }))
          },
          onWorkflowFinished: ({ data }) => {
            if (isTimeout) {
              notify({ type: 'warning', message: t('appDebug.warningMessage.timeoutExceeded') })
              return
            }
            if (data.error) {
              notify({ type: 'error', message: data.error })
              setWorkflowProcessData(produce(getWorkflowProcessData()!, (draft) => {
                draft.status = WorkflowRunningStatus.Failed
              }))
              setRespondingFalse()
              onCompleted(getCompletionRes(), taskId, false)
              isEnd = true
              return
            }
            setWorkflowProcessData(produce(getWorkflowProcessData()!, (draft) => {
              draft.status = WorkflowRunningStatus.Succeeded
              draft.files = getFilesInLogs(data.outputs || []) as any[]
            }))
            if (!data.outputs) {
              setCompletionRes('')
            }
            else {
              setCompletionRes(data.outputs)
              const isStringOutput = Object.keys(data.outputs).length === 1 && typeof data.outputs[Object.keys(data.outputs)[0]] === 'string'
              if (isStringOutput) {
                setWorkflowProcessData(produce(getWorkflowProcessData()!, (draft) => {
                  draft.resultText = data.outputs[Object.keys(data.outputs)[0]]
                }))
              }
            }
            setRespondingFalse()
            setMessageId(tempMessageId)
            onCompleted(getCompletionRes(), taskId, true)
            isEnd = true
          },
          onTextChunk: (params) => {
            const { data: { text } } = params
            setWorkflowProcessData(produce(getWorkflowProcessData()!, (draft) => {
              draft.resultText += text
            }))
          },
          onTextReplace: (params) => {
            const { data: { text } } = params
            setWorkflowProcessData(produce(getWorkflowProcessData()!, (draft) => {
              draft.resultText = text
            }))
          },
        },
        isInstalledApp,
        apiKey,
      )
    }
  }

  const controlSendRef = useRef<number | undefined>()
  const [controlClearMoreLikeThis, setControlClearMoreLikeThis] = useState(0)
  useEffect(() => {
    if (controlSend && controlSendRef?.current !== controlSend) {
      controlSendRef.current = controlSend

      handleSend()
      setControlClearMoreLikeThis(Date.now())
    }
  }, [controlSend])

  useEffect(() => {
    if (controlRetry)
      handleSend()
  }, [controlRetry])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const handleScroll = throttle(() => {
      const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight

      const atBottom = distanceToBottom <= 200
      setIsAtBottom(atBottom)
    }, 200)

    const delay = setTimeout(() => {
      isInitialMount.current = false
      el.addEventListener('scroll', handleScroll)
    }, 300)

    return () => {
      clearTimeout(delay)
      el.removeEventListener('scroll', handleScroll)
    }
  }, [])
  useEffect(() => {
    const el = containerRef.current
    if (!el || !isAtBottom) return

    let attempts = 0
    const maxAttempts = 30
    const delayMs = 16
    const threshold = 10

    const tryScroll = () => {
      if (!el) return
      const scrollTarget = el.scrollHeight - el.clientHeight
      const currentScroll = el.scrollTop
      const distance = Math.abs(currentScroll - scrollTarget)

      if (distance > threshold && attempts < maxAttempts) {
        el.scrollTo({ top: scrollTarget, behavior: 'smooth' })
        attempts++
        requestAnimationFrame(tryScroll)
      }
      else {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
      }
    }

    tryScroll()
  }, [workflowProcessData?.tracing, isAtBottom])

  useEffect(() => {
  }, [renderRef])

  const renderTextGenerationRes = () => (
    <div className=''
      ref={renderRef}
    >
      <div className=' text-sm flex justify-end w-full'>
        <div className='bg-background-section-burn py-2 my- rounded-lg p-2 max-w-[80%] flex-1'>
          {t('run.startAnalysis')}
          {inputs && (
            <div className={cn('my-1')}>
              <CodeEditor
                readOnly
                title={<div>{t('workflow.common.input').toLocaleUpperCase()}</div>}
                language={CodeLanguage.json}
                value={inputs}
                isJSONStringifyBeauty
              />
            </div>
          )}
        </div>
        <div className="shrink-0 w-5 h-5 m-2 mt-3 bg-cover bg-no-repeat bg-[url('~@/app/components/runOnce/text-generation/result/human.svg')]" />
      </div>
      <div className=' text-sm flex w-full justify-start'>
        <div className="shrink-0 w-6 h-6 m-2 mt-3 bg-cover bg-no-repeat bg-[url('~@/app/components/runOnce/text-generation/result/ai.svg')]" />
        <div className='bg-background-section-burn py-2 my-2 rounded-lg p-2 max-w-[80%] ' >
          {t('run.aiAnalysis')}
        </div>
      </div>
      <TracingPanel
        className='bg-background-section-burn mx-10'
        list={workflowProcessData?.tracing || []}
        isForRun={true}
      />
    </div>
    // <TextGenerationRes
    //   isWorkflow={isWorkflow}
    //   workflowProcessData={workflowProcessData}
    //   className='mt-3'
    //   isError={isError}
    //   onRetry={handleSend}
    //   content={completionRes}
    //   messageId={messageId}
    //   isInWebApp
    //   moreLikeThis={moreLikeThisEnabled}
    //   onFeedback={handleFeedback}
    //   feedback={feedback}
    //   onSave={handleSaveMessage}
    //   isMobile={isMobile}
    //   isInstalledApp={isInstalledApp}
    //   installedAppId={installedAppInfo?.id}
    //   isLoading={isCallBatchAPI ? (!completionRes && isResponding) : false}
    //   taskId={isCallBatchAPI ? ((taskId as number) < 10 ? `0${taskId}` : `${taskId}`) : undefined}
    //   controlClearMoreLikeThis={controlClearMoreLikeThis}
    //   isShowTextToSpeech={isShowTextToSpeech}
    //   hideProcessDetail
    //   siteInfo={siteInfo}
    // />
  )

  return (
    <div className={cn(
      isNoData && !isCallBatchAPI && 'h-full',
      'overflow-y-auto h-full',
    )}
    ref={containerRef}

    >      {
        !isCallBatchAPI && isWorkflow && (
          (isResponding && !workflowProcessData)
            ? (
              <div className='flex h-full w-full justify-center items-center'>
                <Loading type='area' />
              </div>
            )
            : !workflowProcessData
              ? <NoData />
              : renderTextGenerationRes()
        )
      }
      {isCallBatchAPI && (
        <div className='mt-2'>
          {renderTextGenerationRes()}
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  )
}
export default React.memo(Result)
