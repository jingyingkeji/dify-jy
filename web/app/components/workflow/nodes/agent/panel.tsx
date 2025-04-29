import type { ComponentProps, FC } from 'react'
import { memo, useMemo } from 'react'
import type { NodePanelProps } from '../../types'
import { AgentFeature, type AgentNodeType } from './types'
import Field from '../_base/components/field'
import { AgentStrategy } from '../_base/components/agent-strategy'
import useConfig from './use-config'
import { useTranslation } from 'react-i18next'
import OutputVars, { VarItem } from '../_base/components/output-vars'
import type { StrategyParamItem } from '@/app/components/plugins/types'
import type { CredentialFormSchema } from '@/app/components/header/account-setting/model-provider-page/declarations'
import BeforeRunForm from '@/app/components/workflow/nodes/_base/components/before-run-form'
import ResultPanel from '@/app/components/workflow/run/result-panel'
import formatTracing from '@/app/components/workflow/run/utils/format-log'
import { useLogs } from '@/app/components/workflow/run/hooks'
import type { Props as FormProps } from '@/app/components/workflow/nodes/_base/components/before-run-form/form'
import { toType } from '@/app/components/tools/utils/to-form-schema'
import { useStore } from '../../store'
import Split from '../_base/components/split'
import MemoryConfig from '../_base/components/memory-config'
import VarReferencePicker from '../_base/components/variable/var-reference-picker'

const i18nPrefix = 'workflow.nodes.agent'

export function strategyParamToCredientialForm(param: StrategyParamItem): CredentialFormSchema {
  return {
    ...param as any,
    variable: param.name,
    show_on: [],
    type: toType(param.type),
    tooltip: param.help,
  }
}

const AgentPanel: FC<NodePanelProps<AgentNodeType>> = (props) => {
  const {
    inputs,
    setInputs,
    currentStrategy,
    formData,
    onFormChange,
    isChatMode,
    availableNodesWithParent,
    availableVars,
    readOnly,
    isShowSingleRun,
    hideSingleRun,
    runningStatus,
    handleRun,
    handleStop,
    runResult,
    runInputData,
    setRunInputData,
    varInputs,
    outputSchema,
    handleMemoryChange,
    shouldShowContextTip,
    handleContextVarChange,
    filterVar,
  } = useConfig(props.id, props.data)
  const { t } = useTranslation()
  const nodeInfo = useMemo(() => {
    if (!runResult)
      return
    return formatTracing([runResult], t)[0]
  }, [runResult, t])
  const logsParams = useLogs()
  const singleRunForms = (() => {
    const forms: FormProps[] = []

    if (varInputs.length > 0) {
      forms.push(
        {
          label: t(`${i18nPrefix}.singleRun.variable`)!,
          inputs: varInputs,
          values: runInputData,
          onChange: setRunInputData,
        },
      )
    }

    return forms
  })()

  const resetEditor = useStore(s => s.setControlPromptEditorRerenderKey)

  const contextRenderField: ComponentProps<typeof AgentStrategy>['contextRenderField'] = () => {
    return (
      <Field
        title={t('workflow.nodes.llm.context')}
        tooltip={t('workflow.nodes.llm.contextTooltip')}
      >
        <>
          <VarReferencePicker
            readonly={readOnly}
            nodeId={props.id}
            isShowNodeName
            value={inputs.context?.variable_selector || []}
            onChange={handleContextVarChange}
            filterVar={filterVar}
          />
          {shouldShowContextTip && (
            <div className='text-xs font-normal leading-[18px] text-[#DC6803]'>{t('workflow.nodes.llm.notSetContextInPromptTip')}</div>
          )}
        </>
      </Field>
    )
  }

  return <div className='my-2'>
    <Field
    required
    title={t('workflow.nodes.agent.strategy.label')}
    className='px-4 py-2'
    tooltip={t('workflow.nodes.agent.strategy.tooltip')} >
      <AgentStrategy
        strategy={inputs.agent_strategy_name ? {
          agent_strategy_provider_name: inputs.agent_strategy_provider_name!,
          agent_strategy_name: inputs.agent_strategy_name!,
          agent_strategy_label: inputs.agent_strategy_label!,
          agent_output_schema: inputs.output_schema,
          plugin_unique_identifier: inputs.plugin_unique_identifier!,
        } : undefined}
        onStrategyChange={(strategy) => {
          setInputs({
            ...inputs,
            agent_strategy_provider_name: strategy?.agent_strategy_provider_name,
            agent_strategy_name: strategy?.agent_strategy_name,
            agent_strategy_label: strategy?.agent_strategy_label,
            output_schema: strategy!.agent_output_schema,
            plugin_unique_identifier: strategy!.plugin_unique_identifier,
            agent_parameters: {},
          })
          resetEditor(Date.now())
        }}
        formSchema={currentStrategy?.parameters?.map(strategyParamToCredientialForm) || []}
        formValue={formData}
        onFormValueChange={onFormChange}
        nodeOutputVars={availableVars}
        availableNodes={availableNodesWithParent}
        nodeId={props.id}
        contextRenderField={currentStrategy?.features?.includes(AgentFeature.CONTEXT) ? contextRenderField : undefined}
      />
    </Field>
    <div className='px-4 py-2'>
      {isChatMode && currentStrategy?.features?.includes(AgentFeature.HISTORY_MESSAGES) && (
        <>
          <Split />
          <MemoryConfig
            className='mt-4'
            readonly={readOnly}
            config={{ data: inputs.memory }}
            onChange={handleMemoryChange}
            canSetRoleName={false}
          />
        </>
      )}
    </div>
    <div>
      <OutputVars>
        <VarItem
          name='text'
          type='String'
          description={t(`${i18nPrefix}.outputVars.text`)}
        />
        <VarItem
          name='files'
          type='Array[File]'
          description={t(`${i18nPrefix}.outputVars.files.title`)}
        />
        <VarItem
          name='json'
          type='Array[Object]'
          description={t(`${i18nPrefix}.outputVars.json`)}
        />
        {outputSchema.map(({ name, type, description }) => (
          <VarItem
            key={name}
            name={name}
            type={type}
            description={description}
          />
        ))}
      </OutputVars>
    </div>
    {
      isShowSingleRun && (
        <BeforeRunForm
          nodeName={inputs.title}
          nodeType={inputs.type}
          onHide={hideSingleRun}
          forms={singleRunForms}
          runningStatus={runningStatus}
          onRun={handleRun}
          onStop={handleStop}
          {...logsParams}
          result={<ResultPanel {...runResult} nodeInfo={nodeInfo} showSteps={false} {...logsParams} />}
        />
      )
    }
  </div>
}

AgentPanel.displayName = 'AgentPanel'

export default memo(AgentPanel)
