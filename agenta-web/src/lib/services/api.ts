import useSWR from "swr"
import axios from "@/lib//helpers/axiosConfig"
import {parseOpenApiSchema} from "@/lib/helpers/openapi_parser"
import {Variant, Parameter, EvaluationResponseType, Evaluation, AppTemplate} from "@/lib/Types"
import {
    fromEvaluationResponseToEvaluation,
    fromEvaluationScenarioResponseToEvaluationScenario,
} from "../transformers"
import {EvaluationType} from "../enums"
/**
 * Raw interface for the parameters parsed from the openapi.json
 */

const fetcher = (url: string) => axios.get(url).then((res) => res.data)

export async function fetchVariants(app: string): Promise<Variant[]> {
    const response = await axios.get(
        `${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/app_variant/list_variants/?app_name=${app}`,
    )

    if (response.data && Array.isArray(response.data) && response.data.length > 0) {
        return response.data.map((variant: Record<string, any>) => {
            let v: Variant = {
                variantName: variant.variant_name,
                templateVariantName: variant.previous_variant_name,
                persistent: true,
                parameters: variant.parameters,
                previousVariantName: variant.previous_variant_name || null,
            }
            return v
        })
    }

    return []
}

/**
 * Calls the variant endpoint with the input parameters and the optional parameters and returns the response.
 * @param inputParametersDict A dictionary of the input parameters to be passed to the variant endpoint
 * @param inputParamDefinition A list of the parameters that are defined in the openapi.json (these are only part of the input params, the rest is defined by the user in the optparms)
 * @param optionalParameters The optional parameters (prompt, models, AND DICTINPUTS WHICH ARE TO BE USED TO ADD INPUTS )
 * @param URIPath
 * @returns
 */
export function callVariant(
    inputParametersDict: Record<string, string>,
    inputParamDefinition: Parameter[],
    optionalParameters: Parameter[],
    URIPath: string,
) {
    console.log("inputParametersDict", inputParametersDict)
    // Separate input parameters into two dictionaries based on the 'input' property
    const mainInputParams: Record<string, string> = {} // Parameters with input = true
    const secondaryInputParams: Record<string, string> = {} // Parameters with input = false
    const inputParams = Object.keys(inputParametersDict).reduce((acc: any, key) => {
        acc[key] = inputParametersDict[key]
        return acc
    }, {})
    for (let key of Object.keys(inputParametersDict)) {
        const paramDefinition = inputParamDefinition.find((param) => param.name === key)

        // If parameter definition is found and its 'input' property is false,
        // then it goes to 'secondaryInputParams', otherwise to 'mainInputParams'
        if (paramDefinition && !paramDefinition.input) {
            secondaryInputParams[key] = inputParametersDict[key]
        } else {
            mainInputParams[key] = inputParametersDict[key]
        }
    }

    optionalParameters = optionalParameters || []

    const optParams = optionalParameters
        .filter((param) => param.default)
        .filter((param) => param.type !== "object") // remove dics from optional parameters
        .reduce((acc: any, param) => {
            acc[param.name] = param.default
            return acc
        }, {})
    const requestBody = {
        ["inputs"]: secondaryInputParams,
        ...mainInputParams,
        ...optParams,
    }

    return axios
        .post(`${process.env.NEXT_PUBLIC_AGENTA_API_URL}/${URIPath}/generate`, requestBody)
        .then((res) => {
            return res.data
        })
}

/**
 * Parses the openapi.json from a variant and returns the parameters as an array of objects.
 * @param app
 * @param variantName
 * @returns
 */
export const getVariantParametersFromOpenAPI = async (app: string, variant: Variant) => {
    const sourceName = variant.templateVariantName
        ? variant.templateVariantName
        : variant.variantName
    const url = `${process.env.NEXT_PUBLIC_AGENTA_API_URL}/${app}/${sourceName}/openapi.json`
    const response = await axios.get(url)
    let APIParams = parseOpenApiSchema(response.data)
    // we create a new param for DictInput that will contain the name of the inputs
    APIParams = APIParams.map((param) => {
        if (param.type === "object") {
            // if param.default is defined
            if (param?.default) {
                param.default = param.default.map((item: string) => {
                    return {name: item}
                })
            } else {
                param.default = []
            }
        }
        return param
    })
    const initOptParams = APIParams.filter((param) => !param.input) // contains the default values too!
    const inputParams = APIParams.filter((param) => param.input) // don't have input values
    return {initOptParams, inputParams}
}

/**
 * Saves a new variant to the database based on previous
 */
export async function saveNewVariant(appName: string, variant: Variant, parameters: Parameter[]) {
    const appVariant = {
        app_name: appName,
        variant_name: variant.templateVariantName,
    }
    await axios.post(
        `${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/app_variant/add/from_previous/`,
        {
            previous_app_variant: appVariant,
            new_variant_name: variant.variantName,
            parameters: parameters.reduce((acc, param) => {
                return {...acc, [param.name]: param.default}
            }, {}),
        },
    )
}

export async function updateVariantParams(
    appName: string,
    variant: Variant,
    parameters: Parameter[],
) {
    await axios.put(
        `${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/app_variant/update_variant_parameters/`,
        {
            app_name: appName,
            variant_name: variant.variantName,
            parameters: parameters.reduce((acc, param) => {
                return {...acc, [param.name]: param.default}
            }, {}),
        },
    )
}

export async function removeApp(appName: string) {
    await axios.delete(`${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/app_variant/remove_app/`, {
        data: {app_name: appName},
    })
}

export async function removeVariant(appName: string, variantName: string) {
    await axios.delete(
        `${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/app_variant/remove_variant/`,
        {data: {app_name: appName, variant_name: variantName}},
    )
}
/**
 * Loads the list of testsets
 * @returns
 */
export const useLoadTestsetsList = (app_name: string) => {
    const {data, error, mutate} = useSWR(
        `${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/testsets?app_name=${app_name}`,
        fetcher,
        {revalidateOnFocus: false},
    )
    return {
        testsets: data,
        isTestsetsLoading: !error && !data,
        isTestsetsLoadingError: error,
        mutate,
    }
}

export async function createNewTestset(appName: string, testsetName: string, testsetData: any) {
    const response = await axios.post(
        `${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/testsets/${appName}`,
        {
            name: testsetName,
            csvdata: testsetData,
        },
    )
    return response
}

export async function updateTestset(testsetId: String, testsetName: string, testsetData: any) {
    const response = await axios.put(
        `${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/testsets/${testsetId}`,
        {
            name: testsetName,
            csvdata: testsetData,
        },
    )
    return response
}

export const loadTestset = async (testsetId: string) => {
    const response = await axios.get(
        `${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/testsets/${testsetId}`,
    )
    return response.data
}

export const deleteTestsets = async (ids: string[]) => {
    const response = await axios({
        method: "delete",
        url: `${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/testsets`,
        data: {testset_ids: ids},
    })
    return response.data
}

const eval_endpoint = axios.create({
    baseURL: `${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/evaluations`,
})

export const loadEvaluations = async (app_name: string) => {
    return await axios
        .get(`${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/evaluations?app_name=${app_name}`)
        .then((responseData) => {
            const evaluations = responseData.data.map((item: EvaluationResponseType) => {
                return fromEvaluationResponseToEvaluation(item)
            })

            return evaluations
        })
}

export const loadEvaluation = async (evaluationId: string) => {
    return await axios
        .get(`${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/evaluations/${evaluationId}`)
        .then((responseData) => {
            return fromEvaluationResponseToEvaluation(responseData.data)
        })
}

export const deleteEvaluations = async (ids: string[]) => {
    await axios({
        method: "delete",
        url: `${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/evaluations`,
        data: {evaluations_ids: ids},
    })
}

export const loadEvaluationsScenarios = async (
    evaluationTableId: string,
    evaluation: Evaluation,
) => {
    return await axios
        .get(
            `${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/evaluations/${evaluationTableId}/evaluation_scenarios`,
        )
        .then((responseData) => {
            const evaluationsRows = responseData.data.map((item: any) => {
                return fromEvaluationScenarioResponseToEvaluationScenario(item, evaluation)
            })

            return evaluationsRows
        })
}

export const updateEvaluation = async (evaluationId: string, data) => {
    const response = await axios.put(
        `${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/evaluations/${evaluationId}`,
        data,
    )
    return response.data
}

export const updateEvaluationScenario = async (
    evaluationTableId: string,
    evaluationScenarioId: string,
    data,
    evaluationType: EvaluationType,
) => {
    const response = await axios.put(
        `${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/evaluations/${evaluationTableId}/evaluation_scenario/${evaluationScenarioId}/${evaluationType}`,
        data,
    )
    return response.data
}

export const postEvaluationScenario = async (evaluationTableId: string, data) => {
    const response = await eval_endpoint.post(
        `${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/evaluations/${evaluationTableId}/evaluation_scenario`,
        data,
    )
    return response.data
}

export const fetchEvaluationResults = async (evaluationId: string) => {
    const response = await axios.get(
        `${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/evaluations/${evaluationId}/results`,
    )
    return response.data
}

export const fetchApps = () => {
    const {data, error, isLoading} = useSWR(
        `${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/app_variant/list_apps/`,
        fetcher,
    )
    return {
        data,
        error,
        isLoading,
    }
}

export const getTemplates = async () => {
    const response = await axios.get(
        `${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/containers/templates/`,
    )
    return response.data
}

export const pullTemplateImage = async (image_name: string) => {
    const response = await axios.get(
        `${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/containers/templates/${image_name}/images/`,
    )
    return response.data
}

export const startTemplate = async (templateObj: AppTemplate) => {
    const response = await axios.post(
        `${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api/app_variant/add/from_template/`,
        templateObj,
    )
    return response
}
