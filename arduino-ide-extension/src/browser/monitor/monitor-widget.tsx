import * as React from 'react';
import * as dateFormat from 'dateformat';
import { postConstruct, injectable, inject } from 'inversify';
import { v4 } from 'uuid';
import { OptionsType } from 'react-select/src/types';
import { isOSX } from '@theia/core/lib/common/os';
import { Event, Emitter } from '@theia/core/lib/common/event';
import { Key, KeyCode } from '@theia/core/lib/browser/keys';
import { DisposableCollection, Disposable } from '@theia/core/lib/common/disposable'
import { ReactWidget, Message, Widget, MessageLoop, Title } from '@theia/core/lib/browser/widgets';
import { TabBarDecorator } from '@theia/core/lib/browser/shell/tab-bar-decorator';
import { WidgetDecoration } from '@theia/core/lib/browser/widget-decoration';
import { Board, Port } from '../../common/protocol/boards-service';
import { MonitorConfig } from '../../common/protocol/monitor-service';
import { ArduinoSelect } from '../widgets/arduino-select';
import { MonitorModel } from './monitor-model';
import { MonitorConnection } from './monitor-connection';
import { MonitorServiceClientImpl } from './monitor-service-client-impl';
import { ArduinoPreferences } from '../arduino-preferences';

@injectable()
export class MonitorWidget extends ReactWidget {

    static readonly ID = 'serial-monitor';

    @inject(MonitorModel)
    protected readonly monitorModel: MonitorModel;

    @inject(MonitorConnection)
    protected readonly monitorConnection: MonitorConnection;

    @inject(MonitorServiceClientImpl)
    protected readonly monitorServiceClient: MonitorServiceClientImpl;

    @inject(ArduinoPreferences)
    protected readonly preferences: ArduinoPreferences;

    protected widgetHeight: number;

    /**
     * Do not touch or use it. It is for setting the focus on the `input` after the widget activation.
     */
    protected focusNode: HTMLElement | undefined;
    /**
     * Guard against re-rendering the view after the close was requested.
     * See: https://github.com/eclipse-theia/theia/issues/6704
     */
    protected closing = false;
    protected readonly clearOutputEmitter = new Emitter<void>();

    constructor() {
        super();
        this.id = MonitorWidget.ID;
        this.title.label = 'Serial Monitor';
        this.title.iconClass = 'monitor-tab-icon';
        this.title.closable = true;
        this.scrollOptions = undefined;
        this.toDispose.push(this.clearOutputEmitter);
        this.toDispose.push(Disposable.create(() => {
            this.monitorConnection.autoConnect = false;
            if (this.monitorConnection.connected) {
                this.monitorConnection.disconnect();
            }
        }));
    }

    @postConstruct()
    protected init(): void {
        this.update();
        this.toDispose.push(this.monitorConnection.onConnectionChanged(() => this.clearConsole()));
    }

    clearConsole(): void {
        this.clearOutputEmitter.fire(undefined);
        this.update();
    }

    dispose(): void {
        super.dispose();
    }

    protected onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        this.monitorConnection.autoConnect = true;
    }

    onCloseRequest(msg: Message): void {
        this.closing = true;
        super.onCloseRequest(msg);
    }

    protected onUpdateRequest(msg: Message): void {
        // TODO: `this.isAttached`
        // See: https://github.com/eclipse-theia/theia/issues/6704#issuecomment-562574713
        if (!this.closing && this.isAttached) {
            super.onUpdateRequest(msg);
        }
    }

    protected onResize(msg: Widget.ResizeMessage): void {
        super.onResize(msg);
        this.widgetHeight = msg.height;
        this.update();
    }

    protected onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        (this.focusNode || this.node).focus();
    }

    protected onFocusResolved = (element: HTMLElement | undefined) => {
        if (this.closing || !this.isAttached) {
            return;
        }
        this.focusNode = element;
        requestAnimationFrame(() => MessageLoop.sendMessage(this, Widget.Msg.ActivateRequest));
    }

    protected get lineEndings(): OptionsType<SelectOption<MonitorModel.EOL>> {
        return [
            {
                label: 'No Line Ending',
                value: ''
            },
            {
                label: 'New Line',
                value: '\n'
            },
            {
                label: 'Carriage Return',
                value: '\r'
            },
            {
                label: 'Both NL & CR',
                value: '\r\n'
            }
        ];
    }

    protected get baudRates(): OptionsType<SelectOption<MonitorConfig.BaudRate>> {
        const baudRates: Array<MonitorConfig.BaudRate> = [300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200];
        return baudRates.map(baudRate => ({ label: baudRate + ' baud', value: baudRate }));
    }

    protected render(): React.ReactNode {
        const { baudRates, lineEndings } = this;
        const lineEnding = lineEndings.find(item => item.value === this.monitorModel.lineEnding) || lineEndings[1]; // Defaults to `\n`.
        const baudRate = baudRates.find(item => item.value === this.monitorModel.baudRate) || baudRates[4]; // Defaults to `9600`.
        return <div className='serial-monitor'>
            <div className='head'>
                <div className='send'>
                    <SerialMonitorSendInput
                        monitorConfig={this.monitorConnection.monitorConfig}
                        resolveFocus={this.onFocusResolved}
                        onSend={this.onSend} />
                </div>
                <div className='config'>
                    <div className='select'>
                        <ArduinoSelect
                            maxMenuHeight={this.widgetHeight - 40}
                            options={lineEndings}
                            defaultValue={lineEnding}
                            onChange={this.onChangeLineEnding} />
                    </div>
                    <div className='select'>
                        <ArduinoSelect
                            className='select'
                            maxMenuHeight={this.widgetHeight - 40}
                            options={baudRates}
                            defaultValue={baudRate}
                            onChange={this.onChangeBaudRate} />
                    </div>
                </div>
            </div>
            <div className='body'>
                <SerialMonitorOutput
                    monitorModel={this.monitorModel}
                    monitorConnection={this.monitorConnection}
                    clearConsoleEvent={this.clearOutputEmitter.event}
                    preferences={this.preferences} />
            </div>
        </div>;
    }

    protected readonly onSend = (value: string) => this.doSend(value);
    protected async doSend(value: string): Promise<void> {
        this.monitorConnection.send(value);
    }

    protected readonly onChangeLineEnding = (option: SelectOption<MonitorModel.EOL>) => {
        this.monitorModel.lineEnding = option.value;
    }

    protected readonly onChangeBaudRate = (option: SelectOption<MonitorConfig.BaudRate>) => {
        this.monitorModel.baudRate = option.value;
    }

}

export namespace SerialMonitorSendInput {
    export interface Props {
        readonly monitorConfig?: MonitorConfig;
        readonly onSend: (text: string) => void;
        readonly resolveFocus: (element: HTMLElement | undefined) => void;
    }
    export interface State {
        text: string;
    }
}

export class SerialMonitorSendInput extends React.Component<SerialMonitorSendInput.Props, SerialMonitorSendInput.State> {

    constructor(props: Readonly<SerialMonitorSendInput.Props>) {
        super(props);
        this.state = { text: '' };
        this.onChange = this.onChange.bind(this);
        this.onSend = this.onSend.bind(this);
        this.onKeyDown = this.onKeyDown.bind(this);
    }

    render(): React.ReactNode {
        return <input
            ref={this.setRef}
            type='text'
            className={`theia-input ${this.props.monitorConfig ? '' : 'warning'}`}
            placeholder={this.placeholder}
            value={this.state.text}
            onChange={this.onChange}
            onKeyDown={this.onKeyDown} />
    }

    protected get placeholder(): string {
        const { monitorConfig } = this.props;
        if (!monitorConfig) {
            return 'Not connected. Select a board and a port to connect automatically.'
        }
        const { board, port } = monitorConfig;
        return `Message (${isOSX ? '⌘' : 'Ctrl'}+Enter to send message to '${Board.toString(board, { useFqbn: false })}' on '${Port.toString(port)}')`;
    }

    protected setRef = (element: HTMLElement | null) => {
        if (this.props.resolveFocus) {
            this.props.resolveFocus(element || undefined);
        }
    }

    protected onChange(event: React.ChangeEvent<HTMLInputElement>): void {
        this.setState({ text: event.target.value });
    }

    protected onSend(): void {
        this.props.onSend(this.state.text);
        this.setState({ text: '' });
    }

    protected onKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
        const keyCode = KeyCode.createKeyCode(event.nativeEvent);
        if (keyCode) {
            const { key, meta, ctrl } = keyCode;
            if (key === Key.ENTER && ((isOSX && meta) || (!isOSX && ctrl))) {
                this.onSend();
            }
        }
    }

}

export namespace SerialMonitorOutput {
    export interface Props {
        readonly monitorModel: MonitorModel;
        readonly monitorConnection: MonitorConnection;
        readonly clearConsoleEvent: Event<void>;
        readonly preferences: ArduinoPreferences;
    }
    export interface State {
        timestamp: boolean;
        lines: JSX.Element[];
        lastLine: string;
    }
}

export class SerialMonitorOutput extends React.Component<SerialMonitorOutput.Props, SerialMonitorOutput.State> {

    /**
     * Do not touch it. It is used to be able to "follow" the serial monitor log.
     */
    protected anchor: HTMLElement | null;
    protected toDisposeBeforeUnmount = new DisposableCollection();
    protected maxLineCount: number;

    constructor(props: Readonly<SerialMonitorOutput.Props>) {
        super(props);
        this.state = { lastLine: '', lines: [], timestamp: this.props.monitorModel.timestamp };
        this.maxLineCount = props.preferences['arduino.monitor.maxOutputLines'] || 5000;
    }

    render(): React.ReactNode {
        return <React.Fragment>
            <div style={({ whiteSpace: 'pre', fontFamily: 'monospace' })}>
                {this.state.lines}
                {this.state.lastLine}
            </div>
            <div style={{ float: 'left', clear: 'both' }} ref={element => { this.anchor = element; }} />
        </React.Fragment>;
    }

    componentDidMount(): void {
        this.scrollToBottom();
        this.toDisposeBeforeUnmount.pushAll([
            this.props.preferences.onPreferenceChanged(({ preferenceName, newValue, oldValue }) => {
                if (preferenceName === 'arduino.monitor.maxOutputLines' && newValue !== oldValue && typeof newValue === 'number' && newValue > 0) {
                    this.maxLineCount = newValue;
                    this.onMessageDidRead({ message: '' });
                }
            }),
            this.props.monitorConnection.onRead(this.onMessageDidRead.bind(this)),
            this.props.clearConsoleEvent(() => this.setState({ lines: [], lastLine: '' })),
            this.props.monitorModel.onChange(({ property }) => {
                if (property === 'timestamp') {
                    const { timestamp } = this.props.monitorModel;
                    this.setState({ timestamp });
                }
            })
        ]);
    }

    private onMessageDidRead({ message, dropped }: { message: string, dropped?: number }): void {
        const rawLines = message.split('\n');
        const lines: string[] = []
        let lastLine = this.state.lastLine;
        const timestamp = () => this.state.timestamp ? `${dateFormat(new Date(), 'H:M:ss.l')} -> ` : '';
        for (let i = 0; i < rawLines.length; i++) {
            if (i === 0 && lastLine) {
                lines.push(`${lastLine}${rawLines[i]}`);
                lastLine = '';
            } else {
                lines.push(timestamp() + rawLines[i]);
            }
        }
        lastLine = lines.pop() || '';
        if (dropped) {
            lastLine = `${lastLine}[DROPPED]\n`;
        }
        const jsxLines = this.maxLineCount <= 1 ? [] : this.state.lines.concat(lines.map(line => <div key={v4()}>{line}</div>)).slice((this.maxLineCount - 1) * -1);
        this.setState({ lines: jsxLines, lastLine }, () => {
            if (this.props.monitorConnection.connected) {
                setTimeout(() => window.requestAnimationFrame(() => this.props.monitorConnection.signalAck()), 0);
            }
        });
    }

    componentDidUpdate(): void {
        this.scrollToBottom();
    }

    componentWillUnmount(): void {
        // TODO: "Your preferred browser's local storage is almost full." Discard `content` before saving layout?
        this.toDisposeBeforeUnmount.dispose();
    }

    protected scrollToBottom(): void {
        if (this.props.monitorModel.autoscroll && this.anchor) {
            this.anchor.scrollIntoView();
        }
    }

}

export interface SelectOption<T> {
    readonly label: string;
    readonly value: T;
}

@injectable()
export class MonitorWidgetTabBarDecorator implements TabBarDecorator {

    @inject(MonitorConnection)
    protected readonly connection: MonitorConnection;

    @inject(ArduinoPreferences)
    protected readonly preferences: ArduinoPreferences;

    protected readonly onDidChangeDecorationsEmitter = new Emitter<void>();
    protected readonly maxHistory = 10;

    protected rateLimiterBuffer: number;
    protected history: number[] = [];
    protected decoration: WidgetDecoration.Data = {};

    @postConstruct()
    protected init(): void {
        this.rateLimiterBuffer = this.preferences['arduino.monitor.rateLimiterBuffer'];
        this.connection.onRead(({ dropped }) => {
            this.history.push(Math.floor(dropped / this.rateLimiterBuffer) * 100);
            this.history = this.history.slice(this.maxHistory * -1);
            this.refresh();
        });
        this.preferences.onPreferenceChanged(({ preferenceName, newValue, oldValue }) => {
            if (preferenceName === 'arduino.monitor.rateLimiterBuffer' && newValue !== oldValue && typeof newValue === 'number' && newValue > 0) {
                this.rateLimiterBuffer = newValue;
                this.history = [];
                this.refresh();
            }
        });
    }

    decorate(title: Title<Widget>): WidgetDecoration.Data[] {
        if (this.decoration && title.owner.id === MonitorWidget.ID) {
            return [
                this.decoration
            ];
        }
        return [];
    }

    private refresh(): void {
        const percentage = Math.floor(this.history.reduce((prev, curr) => prev + curr, 0) / this.maxHistory);
        let newDecoration: WidgetDecoration.Data;
        if (!percentage) {
            newDecoration = {
            }
        } else if (percentage < 25) {
            newDecoration = {
                badge: `${percentage}%` as any
            }
        } else if (percentage < 75) {
            newDecoration = {
                badge: `${percentage}%` as any,
                backgroundColor: 'var(--theia-editorWarning-foreground)'
            }
        } else {
            newDecoration = {
                badge: `${percentage}%` as any,
                backgroundColor: 'var(--theia-errorForeground)'
            }
        }
        const didChange = newDecoration.badge !== this.decoration.badge || newDecoration.backgroundColor !== this.decoration.backgroundColor;
        this.decoration = newDecoration;
        if (didChange) {
            this.onDidChangeDecorationsEmitter.fire();
        }
    }

    get id(): string {
        return 'monitor-widget-tabbar-decorator';
    }

    get onDidChangeDecorations(): Event<void> {
        return this.onDidChangeDecorationsEmitter.event;
    }

}
