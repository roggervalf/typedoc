import { DefaultThemeRenderContext } from "../../DefaultThemeRenderContext";
import { createElement } from "../../../../../utils";
import { TemplateLiteralType } from "../../../../../models";

export const templateLiteral =
    ({ partials }: DefaultThemeRenderContext) =>
    (props: TemplateLiteralType) =>
        (
            <>
                <span class="tsd-signature-symbol">`</span>
                {!!props.head && <span class="tsd-signature-type">{props.head}</span>}
                {props.tail.map((item) => (
                    <>
                        <span class="tsd-signature-symbol">{"${"}</span>
                        {!!item[0] && partials.type(item[0])}
                        <span class="tsd-signature-symbol">{"}"}</span>
                        {!!item[1] && <span class="tsd-signature-type">{item[1]}</span>}
                    </>
                ))}
                <span class="tsd-signature-symbol">`</span>
            </>
        );